-- Lifecycle: managed rows never go dormant; unrepresented placeholders have a
-- bounded, per-row lifecycle.
--
-- Managed = the seller side is represented (_property_side_representation:
-- a homeowner or an EA). A managed row stays in its chain and keeps its
-- address; it never enters dormancy and is never made dormant, archived or
-- released through inactivity. Its only lifecycle exits are completion grace
-- and explicit user action. Buyers, counterparties, viewers, creators and
-- plain property_members never make a row managed.
--
-- Placeholder = not managed and not a searching row. Its clock starts when
-- the seller side becomes unrepresented (seller_side_unrepresented_since,
-- floored at lifecycle_dormancy_effective_from()). Only activity from the
-- row's dependent side restarts it (placeholder_activity_at), or an explicit
-- confirmation (last_still_active_confirmed_at):
--   the purchase's buyer identity holder; the seller side of a same-chain
--   sale linking to the row; a buyer counterparty on the row; the owner of a
--   Buyer Ready node linked to the row.
-- With dependants (_property_placeholder_has_dependants): warning after
-- lifecycle_connected_dormant_days(), then dormant → snapshot → archive →
-- release when the confirmation window ends. Without dependants: dormant →
-- snapshot → archive → release after lifecycle_dormant_inactivity_days().
-- System notices never count; nothing fans out across the chain.
--
-- Columns (property_lifecycle_states):
--   seller_side_unrepresented_since, placeholder_activity_at,
--   next_evaluation_at (+ partial index). The worker selects
--   next_evaluation_at <= now() only; managed rows have no next evaluation
--   unless their chain has completed.
--
-- Functions:
--   lifecycle_dormancy_effective_from()                    (new)
--   _property_is_managed(bigint)                           (new)
--   _property_placeholder_anchor(bigint)                   (new)
--   _refresh_property_seller_side_state(bigint)            (new)
--     Locks the property row, then: managed → clear the clock and return a
--     dormancy_warning / dormant row to active (logged); placeholder → start
--     the clock if it is not running.
--   _record_placeholder_dependent_activity(bigint, text)   (new)
--     Restarts one placeholder's clock; returns its pending warning to active.
--   _is_placeholder_dependent_side_user(bigint, uuid)       (new)
--   _touch_chain_operational_activity(bigint)              (new, chains row only)
--   touch_property_operational_activity(bigint, boolean)   [20260714190000]
--     The property row and its chains row only (no chain-peer writes); a
--     repeat touch in one transaction writes nothing. service_role only (it
--     was executable by PUBLIC).
--   _trg_lifecycle_refresh_seller_side()                   (new trigger fn)
--     identities, EA assignments, counterparties (status), properties
--     (insert; searching / relationship_type changes).
--   _trg_property_lifecycle_states_schedule()              (new trigger fn)
--     A change into completed_grace, dormancy_warning, dormant, archived or
--     released schedules an evaluation now; anonymised clears it.
--   _trg_chains_completion_schedule_lifecycle()            (new trigger fn)
--   _trg_touch_operational_activity_from_activity()        [20260714190000]
--   _trg_touch_operational_activity_from_property()        [20260714190000]
--   _trg_touch_operational_activity_from_counterparty()    [20260714190000]
--   _trg_touch_operational_activity_from_chain_node()      (new trigger fn)
--     System notices are not activity: no touch and no restart. Dependent
--     activity restarts the single linked placeholder. Buyer Ready activity
--     touches only the chains row and that placeholder.
--   property_lifecycle_chain_release_safe(bigint)          [20260714190000]
--     A placeholder in an uncompleted chain is not blocked by unrelated
--     chain activity (its own clock already accounts for its dependants).
--   get_property_lifecycle_signals(bigint)                 [20260725120000]
--     Adds sellerSide, buyerSide, isManaged, sellerSideUnrepresentedSince,
--     placeholderActivityAt, lastStillActiveConfirmedAt,
--     hasPlaceholderDependants, dormancyEffectiveFrom.
--   execute_enter_dormancy_warning(bigint, text, jsonb)    [20260714200000]
--     Per row; no chain peers.
--   execute_property_lifecycle_action(...)                 [20260714190000]
--     Locks the property row, then the lifecycle row; re-checks the seller
--     side and refuses every dormancy step on a managed row (completion steps
--     are exempt); each step re-checks its own state and timing.
--   list_dormancy_warning_notification_targets(bigint)     [20260714200000]
--     The row itself only.
--   get_dormancy_warning_email_recipient(bigint)           [20260714201000]
--     The dependent side; every recipient passes
--     _is_placeholder_dependent_side_user, so whoever is emailed can confirm.
--     Dropped and recreated (recipient_kind).
--   can_confirm_property_still_active(bigint)              (new, internal)
--   confirm_transaction_still_active(bigint)               [20260714202000]
--     Dependent side only, this row only, audited, idempotent within 24 h.
--     Grants no authority and changes no ownership or representation.
--   get_property_lifecycle_status(bigint)                  (new)
--     One primary-key read; the warning detail only for users who can confirm.
--   list_property_lifecycle_worker_candidates(integer)     [20260714190000]
--     Indexed next_evaluation_at query.
--   schedule_property_lifecycle_evaluation(bigint, timestamptz) (new)
--
-- Backfill: placeholders start their clock at apply time; managed rows lose
-- any clock; legacy dormancy_warning / dormant rows return to active (logged)
-- so nothing is released on the first worker run. Legacy archived rows in
-- uncompleted chains are left unscheduled (held). No row is released here.
--
-- Requires: 20261005120000_operational_authority_enforcement.sql.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_src text;
  v_check record;
begin
  foreach v_name in array array[
    'public.get_property_lifecycle_signals_core(bigint)',
    'public.property_lifecycle_read_caller_authorized(bigint)',
    'public.touch_property_operational_activity(bigint, boolean)',
    'public.record_property_lifecycle_transition_worker(bigint, text, text, text, text, jsonb)',
    'public.property_chain_is_connected(bigint)',
    'public.homeowner_has_meaningful_participation(bigint)',
    'public._property_side_representation(bigint)',
    'public._property_placeholder_has_dependants(bigint, uuid)',
    'public.can_operate_property(bigint)',
    'public.lifecycle_dormancy_confirmation_days()',
    'public.lifecycle_dormant_inactivity_days()',
    'public.lifecycle_connected_dormant_days()',
    'public.persist_property_analytics_snapshot(bigint, jsonb, text)',
    'public.execute_property_lifecycle_archive(bigint, text, jsonb)',
    'public.execute_property_lifecycle_release(bigint, text, jsonb)',
    'public.execute_property_lifecycle_anonymise(bigint, text, jsonb)',
    'public.try_claim_dormancy_warning_notification(bigint, uuid, integer)',
    'public.mark_dormancy_warning_notification_sent(bigint, uuid, uuid)',
    'public.release_dormancy_warning_notification_claim(bigint)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'lifecycle_bounded_dormancy aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;

  for v_check in
    select *
    from (values
      ('public.get_property_lifecycle_signals(bigint)', '%property_lifecycle_read_caller_authorized(p_property_id)%get_property_lifecycle_signals_core(p_property_id)%'),
      ('public.get_dormancy_warning_email_recipient(bigint)', '%poi.homeowner_user_id%u.banned_until is null or u.banned_until <= now()%'),
      ('public.list_dormancy_warning_notification_targets(bigint)', '%dormancy_warning_notified_at is null%order by cp.id%'),
      ('public.execute_enter_dormancy_warning(bigint, text, jsonb)', '%join public.property_lifecycle_states pls%notification_pending%'),
      ('public.confirm_transaction_still_active(bigint)', '%poi.homeowner_user_id = v_user_id%''not_authorised''%still_active_confirmation%'),
      ('public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb)', '%when ''mark_dormant'' then%v_state not in (''active'', ''completed_grace'', ''dormancy_warning'')%when ''archive_operational'' then%'),
      ('public.list_property_lifecycle_worker_candidates(integer)', '%interval ''6 hours''%'),
      ('public.property_lifecycle_chain_release_safe(bigint)', '%homeowner_has_meaningful_participation(cp.id)%'),
      ('public.touch_property_operational_activity(bigint, boolean)', '%update public.chains%where chain_id = v_chain_id%'),
      ('public._trg_touch_operational_activity_from_activity()', '%touch_property_operational_activity(new.property_id, true)%'),
      ('public._trg_touch_operational_activity_from_property()', '%new.chain_position is distinct from old.chain_position%'),
      ('public._trg_touch_operational_activity_from_counterparty()', '%new.status = ''active''%'),
      ('public._execute_participation_delink(bigint, text, text, uuid)', '%_property_placeholder_has_dependants%')
    ) as t(signature, fingerprint)
  loop
    if to_regprocedure(v_check.signature) is null then
      raise exception 'lifecycle_bounded_dormancy aborted: % missing', v_check.signature;
    end if;

    select p.prosrc into v_src
    from pg_proc p
    where p.oid = to_regprocedure(v_check.signature);

    if v_src not like v_check.fingerprint then
      raise exception
        'lifecycle_bounded_dormancy aborted: % body differs from the expected source',
        v_check.signature;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'activities'
      and c.column_name = 'chain_node_id'
  ) then
    raise exception 'lifecycle_bounded_dormancy aborted: activities.chain_node_id missing';
  end if;

  for v_check in
    select *
    from (values
      ('activities', 'trg_touch_operational_activity_from_activity'),
      ('properties', 'trg_touch_operational_activity_from_property'),
      ('property_counterparty_participants', 'trg_touch_operational_activity_from_counterparty')
    ) as t(table_name, trigger_name)
  loop
    if not exists (
      select 1
      from pg_trigger t
      where t.tgrelid = to_regclass('public.' || v_check.table_name)
        and t.tgname = v_check.trigger_name
        and not t.tgisinternal
        and t.tgenabled <> 'D'
    ) then
      raise exception
        'lifecycle_bounded_dormancy aborted: trigger %.% missing or disabled',
        v_check.table_name,
        v_check.trigger_name;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Columns, index, configuration
-- ---------------------------------------------------------------------------

alter table public.property_lifecycle_states
  add column if not exists seller_side_unrepresented_since timestamptz null,
  add column if not exists placeholder_activity_at timestamptz null,
  add column if not exists next_evaluation_at timestamptz null;

comment on column public.property_lifecycle_states.seller_side_unrepresented_since is
  'When the seller side last became unrepresented (no homeowner, no EA). Null while the row is managed. Starts the placeholder clock.';

comment on column public.property_lifecycle_states.placeholder_activity_at is
  'Last activity from the placeholder''s dependent side (its buyer, the sale linking to it, a linked Buyer Ready owner). System notices never set it.';

comment on column public.property_lifecycle_states.next_evaluation_at is
  'When the lifecycle worker should evaluate the row next. Null for managed rows outside completion.';

create index if not exists property_lifecycle_states_next_evaluation_idx
  on public.property_lifecycle_states (next_evaluation_at)
  where next_evaluation_at is not null;

create or replace function public.lifecycle_dormancy_effective_from()
returns timestamptz
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.lifecycle_dormancy_effective_from', true), '')::timestamptz,
    timestamptz '2026-10-05 00:00:00+00'
  );
$$;

comment on function public.lifecycle_dormancy_effective_from() is
  'No placeholder clock runs from before this instant (mirrors LIFECYCLE_DORMANCY_EFFECTIVE_FROM).';

-- ---------------------------------------------------------------------------
-- 2) Representation helpers
-- ---------------------------------------------------------------------------

create or replace function public._property_is_managed(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.seller_side from public._property_side_representation(p_property_id) r) <> 'none',
    false
  );
$$;

comment on function public._property_is_managed(bigint) is
  'Internal: true when the seller side of the row is represented (a homeowner or an EA). Buyers and counterparties never make a row managed.';

revoke all on function public._property_is_managed(bigint) from public, anon, authenticated;
grant execute on function public._property_is_managed(bigint) to service_role;

create or replace function public._property_placeholder_anchor(p_property_id bigint)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    pls.seller_side_unrepresented_since,
    pls.placeholder_activity_at,
    pls.last_still_active_confirmed_at,
    public.lifecycle_dormancy_effective_from()
  )
  from public.property_lifecycle_states pls
  where pls.property_id = p_property_id
    and pls.seller_side_unrepresented_since is not null;
$$;

comment on function public._property_placeholder_anchor(bigint) is
  'Internal: the instant a placeholder''s inactivity is measured from (latest of unrepresented-since, dependent activity, confirmation and the effective-from floor). Null when the row is not a placeholder.';

revoke all on function public._property_placeholder_anchor(bigint) from public, anon, authenticated;
grant execute on function public._property_placeholder_anchor(bigint) to service_role;

create or replace function public._refresh_property_seller_side_state(p_property_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_pls public.property_lifecycle_states%rowtype;
  v_state text;
  v_managed boolean;
  v_chain_completed boolean;
begin
  if p_property_id is null then
    return;
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return;
  end if;

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  v_state := coalesce(v_pls.operational_state, 'active');

  if v_state in ('completed_grace', 'archived', 'released', 'anonymised') then
    return;
  end if;

  v_managed := public._property_is_managed(p_property_id);

  if v_managed or v_property.stage = 'searching' then
    if v_pls.property_id is null then
      return;
    end if;

    select c.completed_at is not null
    into v_chain_completed
    from public.chains c
    where c.id = v_property.chain_id;

    v_chain_completed := coalesce(v_chain_completed, false);

    if v_state in ('dormancy_warning', 'dormant') then
      insert into public.property_lifecycle_events (
        property_id,
        from_state,
        to_state,
        trigger,
        scenario,
        reason,
        metadata
      )
      values (
        p_property_id,
        v_state,
        'active',
        'system',
        null,
        'Seller side represented; managed rows are never dormant.',
        jsonb_build_object('source', 'seller_side_represented')
      );
    end if;

    update public.property_lifecycle_states
    set
      operational_state = 'active',
      lifecycle_reason = case
        when v_state in ('dormancy_warning', 'dormant') then 'seller_side_represented'
        else lifecycle_reason
      end,
      entered_state_at = case
        when v_state in ('dormancy_warning', 'dormant') then now()
        else entered_state_at
      end,
      dormancy_warning_at = null,
      dormancy_confirmation_deadline_at = null,
      dormancy_warning_notified_at = null,
      dormancy_warning_notification_claimed_at = null,
      seller_side_unrepresented_since = null,
      next_evaluation_at = case
        when v_chain_completed then coalesce(next_evaluation_at, now())
        else null
      end,
      updated_at = now()
    where property_id = p_property_id
      and (
        v_state in ('dormancy_warning', 'dormant')
        or seller_side_unrepresented_since is not null
        or (next_evaluation_at is not null and not v_chain_completed)
      );

    return;
  end if;

  insert into public.property_lifecycle_states (
    property_id,
    operational_state,
    lifecycle_reason,
    seller_side_unrepresented_since,
    next_evaluation_at
  )
  values (
    p_property_id,
    'active',
    'seller_side_unrepresented',
    now(),
    now()
  )
  on conflict (property_id) do update
  set
    seller_side_unrepresented_since = coalesce(
      public.property_lifecycle_states.seller_side_unrepresented_since,
      excluded.seller_side_unrepresented_since
    ),
    next_evaluation_at = case
      when public.property_lifecycle_states.seller_side_unrepresented_since is null
        then excluded.next_evaluation_at
      else coalesce(public.property_lifecycle_states.next_evaluation_at, excluded.next_evaluation_at)
    end,
    updated_at = now()
  where public.property_lifecycle_states.seller_side_unrepresented_since is null
     or public.property_lifecycle_states.next_evaluation_at is null;
end;
$$;

alter function public._refresh_property_seller_side_state(bigint) owner to postgres;

comment on function public._refresh_property_seller_side_state(bigint) is
  'Internal: after a representation change. Locks the property row, then the lifecycle row. Managed (or searching): clears the placeholder clock and returns dormancy_warning / dormant to active (logged). Placeholder: starts the clock if it is not running. Closed and completion states are left alone.';

revoke all on function public._refresh_property_seller_side_state(bigint) from public, anon, authenticated;
grant execute on function public._refresh_property_seller_side_state(bigint) to service_role;

create or replace function public._trg_lifecycle_refresh_seller_side()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'properties' then
    perform public._refresh_property_seller_side_state(new.id);
  else
    perform public._refresh_property_seller_side_state(new.property_id);
  end if;

  return new;
end;
$$;

alter function public._trg_lifecycle_refresh_seller_side() owner to postgres;

revoke all on function public._trg_lifecycle_refresh_seller_side() from public, anon, authenticated;

drop trigger if exists trg_lifecycle_refresh_seller_side on public.property_operational_identities;
create trigger trg_lifecycle_refresh_seller_side
  after insert or update of status on public.property_operational_identities
  for each row
  execute function public._trg_lifecycle_refresh_seller_side();

drop trigger if exists trg_lifecycle_refresh_seller_side on public.property_ea_assignments;
create trigger trg_lifecycle_refresh_seller_side
  after insert or update of status on public.property_ea_assignments
  for each row
  execute function public._trg_lifecycle_refresh_seller_side();

drop trigger if exists trg_lifecycle_refresh_seller_side on public.property_counterparty_participants;
create trigger trg_lifecycle_refresh_seller_side
  after insert or update of status on public.property_counterparty_participants
  for each row
  execute function public._trg_lifecycle_refresh_seller_side();

drop trigger if exists trg_lifecycle_refresh_seller_side_insert on public.properties;
create trigger trg_lifecycle_refresh_seller_side_insert
  after insert on public.properties
  for each row
  execute function public._trg_lifecycle_refresh_seller_side();

drop trigger if exists trg_lifecycle_refresh_seller_side_update on public.properties;
create trigger trg_lifecycle_refresh_seller_side_update
  after update of stage, relationship_type on public.properties
  for each row
  when (
    (old.stage is distinct from new.stage and (old.stage = 'searching' or new.stage = 'searching'))
    or old.relationship_type is distinct from new.relationship_type
  )
  execute function public._trg_lifecycle_refresh_seller_side();

-- ---------------------------------------------------------------------------
-- 3) Scheduling
-- ---------------------------------------------------------------------------

create or replace function public._trg_property_lifecycle_states_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.operational_state is distinct from old.operational_state then
    if new.operational_state in (
      'completed_grace',
      'dormancy_warning',
      'dormant',
      'archived',
      'released'
    ) then
      new.next_evaluation_at := now();
    elsif new.operational_state = 'anonymised' then
      new.next_evaluation_at := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public._trg_property_lifecycle_states_schedule() from public, anon, authenticated;

drop trigger if exists trg_property_lifecycle_states_schedule on public.property_lifecycle_states;
create trigger trg_property_lifecycle_states_schedule
  before insert or update of operational_state on public.property_lifecycle_states
  for each row
  execute function public._trg_property_lifecycle_states_schedule();

create or replace function public._trg_chains_completion_schedule_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_lifecycle_states (
    property_id,
    operational_state,
    lifecycle_reason,
    next_evaluation_at
  )
  select p.id, 'active', 'chain_completed', now()
  from public.properties p
  where p.chain_id = new.id
  on conflict (property_id) do update
  set
    next_evaluation_at = now(),
    updated_at = now()
  where public.property_lifecycle_states.operational_state = 'active';

  return new;
end;
$$;

alter function public._trg_chains_completion_schedule_lifecycle() owner to postgres;

revoke all on function public._trg_chains_completion_schedule_lifecycle() from public, anon, authenticated;

drop trigger if exists trg_chains_completion_schedule_lifecycle on public.chains;
create trigger trg_chains_completion_schedule_lifecycle
  after update of completed_at on public.chains
  for each row
  when (old.completed_at is null and new.completed_at is not null)
  execute function public._trg_chains_completion_schedule_lifecycle();

create or replace function public.schedule_property_lifecycle_evaluation(
  p_property_id bigint,
  p_next_evaluation_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pls public.property_lifecycle_states%rowtype;
  v_next timestamptz := p_next_evaluation_at;
begin
  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  if v_pls.property_id is null then
    return jsonb_build_object('ok', true, 'property_id', p_property_id, 'scheduled', false);
  end if;

  -- A running placeholder clock, an archived row and a released row still
  -- waiting for its snapshot always keep a next evaluation.
  if v_next is null
     and (
       (
         v_pls.seller_side_unrepresented_since is not null
         and v_pls.operational_state in ('active', 'dormancy_warning', 'dormant')
       )
       or v_pls.operational_state in ('completed_grace', 'archived')
       or (
         v_pls.operational_state = 'released'
         and not exists (
           select 1
           from public.property_analytics_snapshots pas
           where pas.source_property_id = p_property_id
             and pas.snapshot_kind = 'operational_release'
         )
       )
     )
  then
    v_next := now() + interval '1 day';
  end if;

  update public.property_lifecycle_states
  set
    next_evaluation_at = v_next,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'scheduled', v_next is not null,
    'next_evaluation_at', v_next
  );
end;
$$;

comment on function public.schedule_property_lifecycle_evaluation(bigint, timestamptz) is
  'Worker: sets next_evaluation_at. A running placeholder clock, completion grace, an archived row and a released row without its snapshot are never left unscheduled (default: one day).';

revoke all on function public.schedule_property_lifecycle_evaluation(bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_property_lifecycle_evaluation(bigint, timestamptz) to service_role;

create or replace function public.list_property_lifecycle_worker_candidates(
  p_limit integer default 100
)
returns table (property_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select pls.property_id
  from public.property_lifecycle_states pls
  where pls.next_evaluation_at <= now()
    and (
      pls.processing_lease_until is null
      or pls.processing_lease_until < now()
    )
  order by pls.next_evaluation_at
  limit greatest(p_limit, 1);
$$;

comment on function public.list_property_lifecycle_worker_candidates(integer) is
  'Worker: rows whose next evaluation is due and that are not leased, earliest first (partial index on next_evaluation_at).';

revoke all on function public.list_property_lifecycle_worker_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_property_lifecycle_worker_candidates(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Activity: touches and dependent-side restarts
-- ---------------------------------------------------------------------------

create or replace function public._touch_chain_operational_activity(
  p_chain_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_chain_id is null then
    return;
  end if;

  update public.chains
  set last_operational_activity_at = now()
  where id = p_chain_id
    and last_operational_activity_at is distinct from now();
end;
$$;

alter function public._touch_chain_operational_activity(bigint) owner to postgres;

comment on function public._touch_chain_operational_activity(bigint) is
  'Internal: records chain activity on the chains row only (no per-property fan-out). A second touch in the same transaction writes nothing.';

revoke all on function public._touch_chain_operational_activity(bigint) from public, anon, authenticated;
grant execute on function public._touch_chain_operational_activity(bigint) to service_role;

-- The property row and its chains row only. Chain peers are no longer
-- rewritten: chain_last_operational_activity_at reads the chains row first,
-- and lifecycle decisions use the per-row placeholder clock, so the peer
-- fan-out only stamped activity on rows where nothing happened.
create or replace function public.touch_property_operational_activity(
  p_property_id bigint,
  p_touch_chain boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_property_id is null then
    return;
  end if;

  update public.properties
  set last_operational_activity_at = now()
  where id = p_property_id
    and last_operational_activity_at is distinct from now();

  if p_touch_chain then
    perform public._touch_chain_operational_activity(
      (select p.chain_id from public.properties p where p.id = p_property_id)
    );
  end if;
end;
$$;

alter function public.touch_property_operational_activity(bigint, boolean) owner to postgres;

comment on function public.touch_property_operational_activity(bigint, boolean) is
  'Internal: records genuine activity on the property row and (p_touch_chain) its chains row. No chain-peer writes; a repeat touch in the same transaction writes nothing.';

revoke all on function public.touch_property_operational_activity(bigint, boolean) from public, anon, authenticated;
grant execute on function public.touch_property_operational_activity(bigint, boolean) to service_role;

create or replace function public._record_placeholder_dependent_activity(
  p_property_id bigint,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pls public.property_lifecycle_states%rowtype;
begin
  if p_property_id is null then
    return;
  end if;

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  if v_pls.property_id is null
     or v_pls.seller_side_unrepresented_since is null
  then
    return;
  end if;

  if v_pls.operational_state = 'dormancy_warning' then
    insert into public.property_lifecycle_events (
      property_id,
      from_state,
      to_state,
      trigger,
      scenario,
      reason,
      metadata
    )
    values (
      p_property_id,
      'dormancy_warning',
      'active',
      'system',
      'connected_dormant',
      'Activity from the placeholder''s dependent side reset the dormancy clock.',
      jsonb_build_object('source', coalesce(p_source, 'activity'))
    );

    update public.property_lifecycle_states
    set
      operational_state = 'active',
      lifecycle_reason = 'dependent_activity',
      entered_state_at = now(),
      dormancy_warning_at = null,
      dormancy_confirmation_deadline_at = null,
      dormancy_warning_notified_at = null,
      dormancy_warning_notification_claimed_at = null,
      placeholder_activity_at = now(),
      next_evaluation_at = now(),
      updated_at = now()
    where property_id = p_property_id;

    return;
  end if;

  if v_pls.operational_state = 'active'
     and (
       v_pls.placeholder_activity_at is null
       or v_pls.placeholder_activity_at < now() - interval '1 hour'
     )
  then
    update public.property_lifecycle_states
    set
      placeholder_activity_at = now(),
      updated_at = now()
    where property_id = p_property_id;
  end if;
end;
$$;

alter function public._record_placeholder_dependent_activity(bigint, text) owner to postgres;

comment on function public._record_placeholder_dependent_activity(bigint, text) is
  'Internal: restarts one placeholder''s clock after activity from its dependent side and returns its pending warning to active (logged). Managed rows, dormant and closed rows are untouched. Writes at most one lifecycle row.';

revoke all on function public._record_placeholder_dependent_activity(bigint, text) from public, anon, authenticated;
grant execute on function public._record_placeholder_dependent_activity(bigint, text) to service_role;

-- Activities: system notices are not activity (no touch, no clock restart).
-- A non-system activity touches its property and chains row; on a
-- placeholder (only its dependent side can write there) it restarts the
-- clock; on a sale it also restarts the purchase it links to; a Buyer Ready
-- activity (no property_id) touches the chains row and restarts the node's
-- linked row.
create or replace function public._trg_touch_operational_activity_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_linked_property_id bigint;
begin
  if new.updated_by is not distinct from 'system' then
    return new;
  end if;

  if new.property_id is not null then
    perform public.touch_property_operational_activity(new.property_id, true);

    perform public._record_placeholder_dependent_activity(
      new.property_id,
      'placeholder_activity'
    );

    select s.linked_property_id
    into v_linked_property_id
    from public.properties s
    where s.id = new.property_id
      and s.relationship_type = 'sale'
      and s.linked_property_id is not null
      and s.linked_property_id <> s.id;

    perform public._record_placeholder_dependent_activity(
      v_linked_property_id,
      'linked_sale_activity'
    );

    return new;
  end if;

  if new.chain_node_id is not null then
    select cn.chain_id, cn.linked_property_id
    into v_chain_id, v_linked_property_id
    from public.chain_nodes cn
    where cn.id = new.chain_node_id
      and cn.node_type = 'buyer_ready';

    if v_chain_id is not null then
      perform public._touch_chain_operational_activity(v_chain_id);

      perform public._record_placeholder_dependent_activity(
        v_linked_property_id,
        'buyer_ready_activity'
      );
    end if;
  end if;

  return new;
end;
$$;

alter function public._trg_touch_operational_activity_from_activity() owner to postgres;

create or replace function public._trg_touch_operational_activity_from_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (
      new.stage is distinct from old.stage
      or new.status is distinct from old.status
      or new.buyer_connected is distinct from old.buyer_connected
      or new.seller_connected is distinct from old.seller_connected
      or new.chain_id is distinct from old.chain_id
      or new.chain_position is distinct from old.chain_position
    ) then
      perform public.touch_property_operational_activity(new.id, true);
    end if;

    if new.stage is distinct from old.stage then
      perform public._record_placeholder_dependent_activity(
        new.id,
        'placeholder_stage_change'
      );
    end if;

    if new.stage is distinct from old.stage
       and new.relationship_type = 'sale'
       and new.linked_property_id is not null
       and new.linked_property_id <> new.id
    then
      perform public._record_placeholder_dependent_activity(
        new.linked_property_id,
        'linked_sale_stage_change'
      );
    end if;
  end if;

  return new;
end;
$$;

alter function public._trg_touch_operational_activity_from_property() owner to postgres;

create or replace function public._trg_touch_operational_activity_from_counterparty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    perform public.touch_property_operational_activity(new.property_id, true);

    if new.counterparty_role = 'buyer'
       and (tg_op = 'INSERT' or old.status is distinct from 'active')
    then
      perform public._record_placeholder_dependent_activity(
        new.property_id,
        'buyer_counterparty_joined'
      );
    end if;
  end if;

  return new;
end;
$$;

alter function public._trg_touch_operational_activity_from_counterparty() owner to postgres;

-- Buyer Ready progress: the chains row and the node's linked row only.
create or replace function public._trg_touch_operational_activity_from_chain_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.node_type is distinct from 'buyer_ready' then
    return new;
  end if;

  if tg_op = 'INSERT'
    or new.stage is distinct from old.stage
    or new.progress is distinct from old.progress
    or new.status is distinct from old.status
    or new.linked_property_id is distinct from old.linked_property_id
  then
    perform public._touch_chain_operational_activity(new.chain_id);
    perform public._record_placeholder_dependent_activity(
      new.linked_property_id,
      'buyer_ready_progress'
    );
  end if;

  return new;
end;
$$;

alter function public._trg_touch_operational_activity_from_chain_node() owner to postgres;

revoke all on function public._trg_touch_operational_activity_from_chain_node() from public, anon, authenticated;
grant execute on function public._trg_touch_operational_activity_from_chain_node() to service_role;

drop trigger if exists trg_touch_operational_activity_from_chain_node
  on public.chain_nodes;

create trigger trg_touch_operational_activity_from_chain_node
  after insert or update on public.chain_nodes
  for each row
  execute function public._trg_touch_operational_activity_from_chain_node();

-- ---------------------------------------------------------------------------
-- 5) Release safety: placeholders are not held by unrelated chain activity
-- ---------------------------------------------------------------------------

create or replace function public.property_lifecycle_chain_release_safe(
  p_property_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_state text;
  v_connected boolean;
  v_chain_completed boolean := false;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return false;
  end if;

  select operational_state
  into v_state
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_property.chain_id is not null then
    select c.completed_at is not null
    into v_chain_completed
    from public.chains c
    where c.id = v_property.chain_id;

    v_chain_completed := coalesce(v_chain_completed, false);
  end if;

  -- An unrepresented placeholder follows its own clock, which its dependants
  -- already restart; another row's progress does not hold it.
  if not v_chain_completed
     and exists (
       select 1
       from public.property_lifecycle_states pls
       where pls.property_id = p_property_id
         and pls.seller_side_unrepresented_since is not null
     )
     and not public._property_is_managed(p_property_id)
  then
    return true;
  end if;

  v_connected := public.property_chain_is_connected(p_property_id);

  if not v_connected or v_property.chain_id is null then
    return true;
  end if;

  -- Fail closed when another chain member is still actively progressing.
  if exists (
    select 1
    from public.properties cp
    join public.property_lifecycle_states pls
      on pls.property_id = cp.id
    where cp.chain_id = v_property.chain_id
      and cp.id <> p_property_id
      and coalesce(pls.operational_state, 'active') in (
        'active',
        'completed_grace'
      )
      and public.homeowner_has_meaningful_participation(cp.id)
  ) then
    return false;
  end if;

  -- Fail closed when another member is in dormancy warning with time remaining.
  if exists (
    select 1
    from public.properties cp
    join public.property_lifecycle_states pls
      on pls.property_id = cp.id
    where cp.chain_id = v_property.chain_id
      and cp.id <> p_property_id
      and pls.operational_state = 'dormancy_warning'
      and (
        pls.dormancy_confirmation_deadline_at is null
        or pls.dormancy_confirmation_deadline_at > now()
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.property_lifecycle_chain_release_safe(bigint) is
  'Fail-closed check before lifecycle archive/release. An unrepresented placeholder in an uncompleted chain is safe (its own clock covers its dependants); otherwise another actively progressing or warned chain member blocks release.';

revoke all on function public.property_lifecycle_chain_release_safe(bigint) from public, anon, authenticated;
grant execute on function public.property_lifecycle_chain_release_safe(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 6) Lifecycle signals
-- ---------------------------------------------------------------------------

create or replace function public.get_property_lifecycle_signals(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_sides record;
  v_pls public.property_lifecycle_states%rowtype;
  v_has_dependants boolean := false;
begin
  if not public.property_lifecycle_read_caller_authorized(p_property_id) then
    if auth.uid() is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;

    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_result := public.get_property_lifecycle_signals_core(p_property_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or jsonb_typeof(v_result -> 'context') is distinct from 'object'
  then
    return v_result;
  end if;

  select *
  into v_sides
  from public._property_side_representation(p_property_id);

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id;

  if v_sides.seller_side = 'none' and v_pls.seller_side_unrepresented_since is not null then
    v_has_dependants := public._property_placeholder_has_dependants(p_property_id, null);
  end if;

  return jsonb_set(
    v_result,
    '{context}',
    (v_result -> 'context') || jsonb_build_object(
      'sellerSide', v_sides.seller_side,
      'buyerSide', v_sides.buyer_side,
      'isManaged', v_sides.seller_side <> 'none',
      'sellerSideUnrepresentedSince', v_pls.seller_side_unrepresented_since,
      'placeholderActivityAt', v_pls.placeholder_activity_at,
      'lastStillActiveConfirmedAt', v_pls.last_still_active_confirmed_at,
      'hasPlaceholderDependants', v_has_dependants,
      'nextEvaluationAt', v_pls.next_evaluation_at,
      'dormancyEffectiveFrom', public.lifecycle_dormancy_effective_from()
    )
  );
end;
$$;

comment on function public.get_property_lifecycle_signals(bigint) is
  'Authorised lifecycle signal read (membership, EA assignment, or service_role). Adds representation (sellerSide, buyerSide, isManaged) and placeholder clock signals.';

revoke all on function public.get_property_lifecycle_signals(bigint) from public, anon;
grant execute on function public.get_property_lifecycle_signals(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Dormancy warning: this row only
-- ---------------------------------------------------------------------------

create or replace function public.execute_enter_dormancy_warning(
  p_property_id bigint,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_notified_at timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1
    from public.properties
    where id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select operational_state, dormancy_warning_notified_at
  into v_state, v_notified_at
  from public.property_lifecycle_states
  where property_id = p_property_id;

  v_state := coalesce(v_state, 'active');

  if v_state = 'dormancy_warning' then
    update public.property_lifecycle_states
    set
      last_evaluated_at = now(),
      updated_at = now()
    where property_id = p_property_id;

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'idempotent', true,
      'operational_state', 'dormancy_warning',
      'notification_pending', v_notified_at is null
    );
  end if;

  if v_state <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', true, 'operational_state', v_state);
  end if;

  v_result := public.record_property_lifecycle_transition_worker(
    p_property_id,
    'dormancy_warning',
    'worker',
    'connected_dormant',
    p_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('action', 'enter_dormancy_warning')
  );

  return v_result || jsonb_build_object('notification_pending', true);
end;
$$;

comment on function public.execute_enter_dormancy_warning(bigint, text, jsonb) is
  'Worker: moves one placeholder into dormancy_warning. Never touches other rows in the chain.';

revoke all on function public.execute_enter_dormancy_warning(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.execute_enter_dormancy_warning(bigint, text, jsonb) to service_role;

create or replace function public.list_dormancy_warning_notification_targets(
  p_source_property_id bigint
)
returns table (
  property_id bigint,
  chain_id bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.chain_id
  from public.properties p
  join public.property_lifecycle_states pls
    on pls.property_id = p.id
  where p.id = p_source_property_id
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null;
$$;

comment on function public.list_dormancy_warning_notification_targets(bigint) is
  'Worker: the row itself when its dormancy warning is pending notification. No chain-wide targets.';

revoke all on function public.list_dormancy_warning_notification_targets(bigint) from public, anon, authenticated;
grant execute on function public.list_dormancy_warning_notification_targets(bigint) to service_role;

-- The placeholder's dependent side: the only people who can confirm it is
-- still wanted, and so the only people the warning is sent to. A linking
-- sale's EA counts only when it may update that sale.
create or replace function public._is_placeholder_dependent_side_user(
  p_property_id bigint,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.properties p
      where p.id = p_property_id
        and (
          (
            p.relationship_type = 'purchase'
            and exists (
              select 1
              from public.property_operational_identities poi
              where poi.property_id = p.id
                and poi.status = 'active'
                and poi.homeowner_user_id = p_user_id
            )
          )
          or exists (
            select 1
            from public.property_counterparty_participants cp
            where cp.property_id = p.id
              and cp.status = 'active'
              and cp.counterparty_role = 'buyer'
              and cp.user_id = p_user_id
          )
          or exists (
            select 1
            from public.properties s
            where s.linked_property_id = p.id
              and s.id <> p.id
              and s.chain_id is not distinct from p.chain_id
              and s.relationship_type = 'sale'
              and (
                exists (
                  select 1
                  from public.property_operational_identities spoi
                  where spoi.property_id = s.id
                    and spoi.status = 'active'
                    and spoi.homeowner_user_id = p_user_id
                )
                or exists (
                  select 1
                  from public.property_ea_assignments spea
                  inner join public.ea_branch_members bm
                    on bm.branch_id = spea.branch_id
                  where spea.property_id = s.id
                    and spea.status = 'active'
                    and bm.user_id = p_user_id
                    and (
                      spea.homeowner_only_updates = false
                      or public._property_seller_side_user_id(s.id) is null
                    )
                )
              )
          )
          or exists (
            select 1
            from public.chain_nodes cn
            where cn.linked_property_id = p.id
              and cn.node_type = 'buyer_ready'
              and cn.user_id = p_user_id
          )
        )
    );
$$;

comment on function public._is_placeholder_dependent_side_user(bigint, uuid) is
  'Internal: true when the user is on the placeholder''s dependent side: the purchase''s buyer, a buyer counterparty, the seller (or the EA that may update it) of a same-chain sale linking to it, or the owner of a linked Buyer Ready node. Shared by confirmation, the status read and the warning recipient.';

revoke all on function public._is_placeholder_dependent_side_user(bigint, uuid) from public, anon, authenticated;
grant execute on function public._is_placeholder_dependent_side_user(bigint, uuid) to service_role;

drop function if exists public.get_dormancy_warning_email_recipient(bigint);

create function public.get_dormancy_warning_email_recipient(
  p_property_id bigint
)
returns table (
  property_id bigint,
  chain_id bigint,
  recipient_user_id uuid,
  recipient_email text,
  recipient_kind text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with target as (
    select p.id, p.chain_id, p.relationship_type
    from public.properties p
    join public.property_lifecycle_states pls
      on pls.property_id = p.id
    where p.id = p_property_id
      and pls.operational_state = 'dormancy_warning'
      and pls.dormancy_warning_notified_at is null
  ),
  candidates as (
    -- The purchase's buyer.
    select poi.homeowner_user_id as user_id, 'buyer'::text as kind, 1 as priority, 0 as rank, poi.granted_at as since
    from target t
    join public.property_operational_identities poi
      on poi.property_id = t.id
     and poi.status = 'active'
    where t.relationship_type = 'purchase'

    union all

    -- A buyer counterparty on the row.
    select cp.user_id, 'buyer'::text, 2, 0, cp.granted_at
    from target t
    join public.property_counterparty_participants cp
      on cp.property_id = t.id
     and cp.status = 'active'
     and cp.counterparty_role = 'buyer'

    union all

    -- The seller of a same-chain sale linking to the row.
    select spoi.homeowner_user_id, 'buyer'::text, 3, 0, spoi.granted_at
    from target t
    join public.properties s
      on s.linked_property_id = t.id
     and s.id <> t.id
     and s.chain_id is not distinct from t.chain_id
     and s.relationship_type = 'sale'
    join public.property_operational_identities spoi
      on spoi.property_id = s.id
     and spoi.status = 'active'

    union all

    -- The owner of a Buyer Ready node linked to the row.
    select cn.user_id, 'buyer'::text, 4, 0, null::timestamptz
    from target t
    join public.chain_nodes cn
      on cn.linked_property_id = t.id
     and cn.node_type = 'buyer_ready'
    where cn.user_id is not null

    union all

    -- The EA branch operating that linking sale (branch admins first): only
    -- when it may update the sale (homeowner_only_updates = false, or the sale
    -- has no seller homeowner), the same rule as confirmation.
    select bm.user_id, 'estate_agent'::text, 5,
      case when bm.role = 'branch_admin' then 0 else 1 end,
      bm.joined_at
    from target t
    join public.properties s
      on s.linked_property_id = t.id
     and s.id <> t.id
     and s.chain_id is not distinct from t.chain_id
     and s.relationship_type = 'sale'
    join public.property_ea_assignments pea
      on pea.property_id = s.id
     and pea.status = 'active'
     and (
       pea.homeowner_only_updates = false
       or public._property_seller_side_user_id(s.id) is null
     )
    join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
  )
  select
    t.id,
    t.chain_id,
    c.user_id,
    lower(trim(u.email)),
    c.kind
  from target t
  cross join candidates c
  join auth.users u
    on u.id = c.user_id
  where u.email is not null
    and trim(u.email) <> ''
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    -- The recipient must be able to confirm (confirm_transaction_still_active).
    and public._is_placeholder_dependent_side_user(t.id, c.user_id)
  order by c.priority, c.rank, c.since nulls last, c.user_id
  limit 1;
$$;

comment on function public.get_dormancy_warning_email_recipient(bigint) is
  'Worker: the dormancy warning recipient for a placeholder pending notification, from its dependent side: the purchase''s buyer, a buyer counterparty, the seller of a linking sale, a linked Buyer Ready owner, then the EA branch operating the linking sale (branch admins first; only when it may update that sale). Every recipient passes _is_placeholder_dependent_side_user, so whoever is emailed can confirm. Verified, unbanned accounts only; no recipient means no email.';

revoke all on function public.get_dormancy_warning_email_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_dormancy_warning_email_recipient(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 8) Still-active confirmation: the dependent side, this row only
-- ---------------------------------------------------------------------------
-- _is_placeholder_dependent_side_user is defined in section 7, before the
-- warning recipient that filters on it.

create or replace function public.can_confirm_property_still_active(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.property_lifecycle_states pls
      where pls.property_id = p_property_id
        and pls.seller_side_unrepresented_since is not null
        and pls.operational_state in ('active', 'dormancy_warning')
    )
    and public._is_placeholder_dependent_side_user(p_property_id, auth.uid());
$$;

alter function public.can_confirm_property_still_active(bigint) owner to postgres;

comment on function public.can_confirm_property_still_active(bigint) is
  'Internal: the caller may confirm the placeholder is still wanted (its dependent side, while its clock runs).';

revoke all on function public.can_confirm_property_still_active(bigint) from public, anon, authenticated;
grant execute on function public.can_confirm_property_still_active(bigint) to service_role;

create or replace function public.confirm_transaction_still_active(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_property public.properties%rowtype;
  v_pls public.property_lifecycle_states%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  if v_pls.property_id is null
     or v_pls.seller_side_unrepresented_since is null
  then
    -- Managed rows have no clock to confirm.
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', coalesce(v_pls.operational_state, 'active'),
      'idempotent', true,
      'managed', true
    );
  end if;

  if not public._is_placeholder_dependent_side_user(p_property_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;

  if v_pls.operational_state not in ('active', 'dormancy_warning') then
    return jsonb_build_object('ok', false, 'error', 'invalid_state_for_confirmation');
  end if;

  if v_pls.operational_state = 'active'
     and exists (
       select 1
       from public.property_lifecycle_still_active_confirmations c
       where c.property_id = p_property_id
         and c.confirmed_at > now() - interval '24 hours'
     )
  then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operational_state', 'active',
      'idempotent', true
    );
  end if;

  insert into public.property_lifecycle_still_active_confirmations (
    property_id,
    chain_id,
    user_id,
    confirmation_code
  )
  values (
    p_property_id,
    v_property.chain_id,
    v_user_id,
    'still_active'
  );

  if v_pls.operational_state = 'dormancy_warning' then
    insert into public.property_lifecycle_events (
      property_id,
      from_state,
      to_state,
      trigger,
      scenario,
      reason,
      metadata
    )
    values (
      p_property_id,
      'dormancy_warning',
      'active',
      'still_active_confirmation',
      'connected_dormant',
      'Structured still-active confirmation reset dormancy clock.',
      jsonb_build_object('confirmation_code', 'still_active', 'confirmed_by', v_user_id)
    );
  end if;

  update public.property_lifecycle_states
  set
    operational_state = 'active',
    lifecycle_reason = case
      when operational_state = 'dormancy_warning' then 'still_active_confirmation'
      else lifecycle_reason
    end,
    entered_state_at = case
      when operational_state = 'dormancy_warning' then now()
      else entered_state_at
    end,
    dormancy_warning_at = null,
    dormancy_confirmation_deadline_at = null,
    dormancy_warning_notified_at = null,
    dormancy_warning_notification_claimed_at = null,
    last_still_active_confirmed_at = now(),
    next_evaluation_at = now() + make_interval(
      days => least(
        public.lifecycle_dormant_inactivity_days(),
        public.lifecycle_connected_dormant_days()
      )
    ),
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'operational_state', 'active'
  );
end;
$$;

comment on function public.confirm_transaction_still_active(bigint) is
  'Structured still-active confirmation for a placeholder by its dependent side. Restarts this row''s clock only, audited, idempotent within 24 hours. Grants no authority; ownership and representation are unchanged. A managed row is a no-op.';

revoke all on function public.confirm_transaction_still_active(bigint) from public, anon;
grant execute on function public.confirm_transaction_still_active(bigint) to authenticated;

create or replace function public.get_property_lifecycle_status(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state text;
  v_deadline timestamptz;
  v_placeholder boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select
    pls.operational_state,
    pls.dormancy_confirmation_deadline_at,
    pls.seller_side_unrepresented_since is not null
  into v_state, v_deadline, v_placeholder
  from public.property_lifecycle_states pls
  where pls.property_id = p_property_id;

  if v_state is distinct from 'dormancy_warning' or not coalesce(v_placeholder, false) then
    return jsonb_build_object('ok', true, 'in_warning', false);
  end if;

  if not public._is_placeholder_dependent_side_user(p_property_id, auth.uid()) then
    return jsonb_build_object('ok', true, 'in_warning', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'in_warning', true,
    'can_confirm', true,
    'confirmation_deadline_at', v_deadline
  );
end;
$$;

alter function public.get_property_lifecycle_status(bigint) owner to postgres;

comment on function public.get_property_lifecycle_status(bigint) is
  'Dormancy warning status for the property and Buyer Ready pages. One primary-key read; rows outside a placeholder warning return in_warning=false at once. The warning (and its deadline) is shown only to users who can confirm it.';

revoke all on function public.get_property_lifecycle_status(bigint) from public, anon;
grant execute on function public.get_property_lifecycle_status(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Lifecycle action dispatcher
-- ---------------------------------------------------------------------------
-- Locks the property row, then the lifecycle row (the order claim, join and
-- delink use). Dormancy steps are refused on a managed row; completion steps
-- (a completed chain) are exempt. Each step re-checks the state and timing it
-- needs, so a plan evaluated before a reset, a confirmation or a new
-- representative cannot archive or release:
--   enter_dormancy_warning   active placeholder with dependants, past the
--                            connected window
--   expire_dormancy_warning  dormancy_warning past its deadline → dormant
--   mark_dormant             active placeholder without dependants, past the
--                            inactivity window → dormant
--   create_analytics_snapshot dormant, completed_grace, archived or released
--   archive_operational      dormant or completed_grace → archived
--   release_property         archived → released

create or replace function public.execute_property_lifecycle_action(
  p_property_id bigint,
  p_action text,
  p_scenario text,
  p_reason text,
  p_worker_run_id uuid,
  p_snapshot_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_pls public.property_lifecycle_states%rowtype;
  v_state text;
  v_deadline timestamptz;
  v_anchor timestamptz;
  v_chain_completed boolean := false;
  v_managed boolean;
  v_metadata jsonb := jsonb_build_object('worker_run_id', p_worker_run_id);
  v_snapshot_result jsonb;
begin
  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found', 'action', p_action);
  end if;

  select *
  into v_pls
  from public.property_lifecycle_states
  where property_id = p_property_id
  for update;

  v_state := coalesce(v_pls.operational_state, 'active');

  if v_state in ('released', 'anonymised')
    and p_action in (
      'enter_completed_grace',
      'enter_dormancy_warning',
      'expire_dormancy_warning',
      'mark_dormant',
      'archive_operational',
      'release_property'
    ) then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'action', p_action,
      'skipped', true,
      'reason', 'already_released_or_anonymised'
    );
  end if;

  if v_property.chain_id is not null then
    select c.completed_at is not null
    into v_chain_completed
    from public.chains c
    where c.id = v_property.chain_id;

    v_chain_completed := coalesce(v_chain_completed, false);
  end if;

  if not v_chain_completed
     and v_state <> 'completed_grace'
     and p_action in (
       'enter_dormancy_warning',
       'expire_dormancy_warning',
       'mark_dormant',
       'create_analytics_snapshot',
       'archive_operational',
       'release_property'
     )
     and v_state in ('active', 'dormancy_warning', 'dormant')
  then
    v_managed := public._property_is_managed(p_property_id);

    if v_managed then
      perform public._refresh_property_seller_side_state(p_property_id);

      return jsonb_build_object(
        'ok', true,
        'property_id', p_property_id,
        'action', p_action,
        'skipped', true,
        'reason', 'seller_side_represented'
      );
    end if;
  end if;

  case p_action
    when 'enter_completed_grace' then
      if v_state <> 'active' or not v_chain_completed then
        return jsonb_build_object('ok', true, 'skipped', true, 'action', p_action);
      end if;

      return public.record_property_lifecycle_transition_worker(
        p_property_id,
        'completed_grace',
        'worker',
        p_scenario,
        p_reason,
        v_metadata
      );

    when 'enter_dormancy_warning' then
      v_anchor := public._property_placeholder_anchor(p_property_id);

      if v_state <> 'active'
         or v_anchor is null
         or v_anchor > now() - make_interval(days => public.lifecycle_connected_dormant_days())
         or not public._property_placeholder_has_dependants(p_property_id, null)
      then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'reason', 'warning_not_due',
          'operational_state', v_state
        );
      end if;

      return public.execute_enter_dormancy_warning(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'expire_dormancy_warning' then
      v_deadline := coalesce(
        v_pls.dormancy_confirmation_deadline_at,
        v_pls.dormancy_warning_at + make_interval(days => public.lifecycle_dormancy_confirmation_days())
      );

      if v_state <> 'dormancy_warning' or v_deadline is null or v_deadline > now() then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'reason', 'warning_not_expired',
          'operational_state', v_state
        );
      end if;

      return public.record_property_lifecycle_transition_worker(
        p_property_id,
        'dormant',
        'worker',
        p_scenario,
        p_reason,
        v_metadata || jsonb_build_object('action', p_action)
      );

    when 'mark_dormant' then
      v_anchor := public._property_placeholder_anchor(p_property_id);

      if v_state <> 'active'
         or v_anchor is null
         or v_anchor > now() - make_interval(days => public.lifecycle_dormant_inactivity_days())
         or public._property_placeholder_has_dependants(p_property_id, null)
      then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'reason', 'dormancy_not_due',
          'operational_state', v_state
        );
      end if;

      return public.record_property_lifecycle_transition_worker(
        p_property_id,
        'dormant',
        'worker',
        p_scenario,
        p_reason,
        v_metadata
      );

    when 'create_analytics_snapshot' then
      if v_state not in ('dormant', 'completed_grace', 'archived', 'released') then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'operational_state', v_state
        );
      end if;

      if p_snapshot_payload is null then
        return jsonb_build_object('ok', false, 'error', 'snapshot_payload_required');
      end if;

      v_snapshot_result := public.persist_property_analytics_snapshot(
        p_property_id,
        p_snapshot_payload,
        'operational_release'
      );

      return v_snapshot_result || jsonb_build_object('action', p_action);

    when 'archive_operational' then
      if v_state not in ('dormant', 'completed_grace', 'archived') then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'operational_state', v_state
        );
      end if;

      return public.execute_property_lifecycle_archive(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'release_property' then
      if v_state <> 'archived' then
        return jsonb_build_object(
          'ok', true,
          'skipped', true,
          'action', p_action,
          'operational_state', v_state
        );
      end if;

      if not public.property_lifecycle_chain_release_safe(p_property_id) then
        return jsonb_build_object(
          'ok', false,
          'error', 'chain_release_unsafe',
          'action', p_action
        );
      end if;

      return public.execute_property_lifecycle_release(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    when 'anonymise_historical' then
      if v_state <> 'released' then
        return jsonb_build_object('ok', true, 'skipped', true, 'action', p_action);
      end if;

      return public.execute_property_lifecycle_anonymise(
        p_property_id,
        p_reason,
        v_metadata
      ) || jsonb_build_object('action', p_action);

    else
      return jsonb_build_object('ok', false, 'error', 'unknown_action');
  end case;
end;
$$;

revoke all on function public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10) Backfill (no row is released here)
-- ---------------------------------------------------------------------------

-- Managed rows: no clock; a legacy warning or dormancy is cleared (logged).
with managed as (
  select pls.property_id, pls.operational_state
  from public.property_lifecycle_states pls
  where pls.operational_state in ('active', 'dormancy_warning', 'dormant')
    and public._property_is_managed(pls.property_id)
),
logged as (
  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    m.property_id,
    m.operational_state,
    'active',
    'system',
    null,
    'Lifecycle rollout: managed rows are never dormant.',
    jsonb_build_object('source', 'lifecycle_rollout_20261005130000')
  from managed m
  where m.operational_state in ('dormancy_warning', 'dormant')
  returning property_id
)
update public.property_lifecycle_states pls
set
  operational_state = 'active',
  lifecycle_reason = case
    when pls.operational_state in ('dormancy_warning', 'dormant') then 'lifecycle_rollout_managed'
    else pls.lifecycle_reason
  end,
  entered_state_at = case
    when pls.operational_state in ('dormancy_warning', 'dormant') then now()
    else pls.entered_state_at
  end,
  dormancy_warning_at = null,
  dormancy_confirmation_deadline_at = null,
  dormancy_warning_notified_at = null,
  dormancy_warning_notification_claimed_at = null,
  seller_side_unrepresented_since = null,
  next_evaluation_at = null,
  updated_at = now()
from managed m
where m.property_id = pls.property_id;

-- Legacy warnings and dormancy on unrepresented rows were produced by the
-- chain-wide model; they return to active (logged) and restart from the
-- placeholder clock below, so nothing is released on the first run.
with legacy as (
  select pls.property_id, pls.operational_state
  from public.property_lifecycle_states pls
  join public.properties p
    on p.id = pls.property_id
  left join public.chains c
    on c.id = p.chain_id
  where pls.operational_state in ('dormancy_warning', 'dormant')
    and c.completed_at is null
),
logged as (
  insert into public.property_lifecycle_events (
    property_id,
    from_state,
    to_state,
    trigger,
    scenario,
    reason,
    metadata
  )
  select
    l.property_id,
    l.operational_state,
    'active',
    'system',
    null,
    'Lifecycle rollout: legacy dormancy state cleared; the placeholder clock restarts.',
    jsonb_build_object('source', 'lifecycle_rollout_20261005130000')
  from legacy l
  returning property_id
)
update public.property_lifecycle_states pls
set
  operational_state = 'active',
  lifecycle_reason = 'lifecycle_rollout_placeholder',
  entered_state_at = now(),
  dormancy_warning_at = null,
  dormancy_confirmation_deadline_at = null,
  dormancy_warning_notified_at = null,
  dormancy_warning_notification_claimed_at = null,
  updated_at = now()
from legacy l
where l.property_id = pls.property_id;

-- Unrepresented, unclosed, non-searching rows start their clock now (floored
-- at the effective-from instant when evaluated).
insert into public.property_lifecycle_states (
  property_id,
  operational_state,
  lifecycle_reason,
  seller_side_unrepresented_since,
  next_evaluation_at
)
select
  p.id,
  'active',
  'seller_side_unrepresented',
  now(),
  now()
from public.properties p
left join public.property_lifecycle_states pls
  on pls.property_id = p.id
left join public.chains c
  on c.id = p.chain_id
where p.stage is distinct from 'searching'
  and coalesce(pls.operational_state, 'active') = 'active'
  and c.completed_at is null
  and not public._property_is_managed(p.id)
on conflict (property_id) do update
set
  seller_side_unrepresented_since = coalesce(
    public.property_lifecycle_states.seller_side_unrepresented_since,
    excluded.seller_side_unrepresented_since
  ),
  next_evaluation_at = now(),
  updated_at = now();

-- Completion follow-ups keep running: active rows in completed chains, rows
-- in completion grace, archived rows in completed chains and released rows
-- still waiting for their analytics snapshot.
update public.property_lifecycle_states pls
set
  next_evaluation_at = now(),
  updated_at = now()
from public.properties p
left join public.chains c
  on c.id = p.chain_id
where p.id = pls.property_id
  and pls.next_evaluation_at is null
  and (
    (pls.operational_state = 'active' and c.completed_at is not null)
    or pls.operational_state = 'completed_grace'
    or (pls.operational_state = 'archived' and c.completed_at is not null)
    or (
      pls.operational_state = 'released'
      and not exists (
        select 1
        from public.property_analytics_snapshots pas
        where pas.source_property_id = pls.property_id
          and pas.snapshot_kind = 'operational_release'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 11) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_offenders text[];
begin
  select array_agg(v_check.signature order by v_check.signature)
  into v_offenders
  from (values
    ('public._property_is_managed(bigint)', '%_property_side_representation%'),
    ('public._refresh_property_seller_side_state(bigint)', '%for update%_property_is_managed%seller_side_unrepresented_since%'),
    ('public._record_placeholder_dependent_activity(bigint, text)', '%seller_side_unrepresented_since is null%placeholder_activity_at%'),
    ('public._touch_chain_operational_activity(bigint)', '%update public.chains%is distinct from now()%'),
    ('public.touch_property_operational_activity(bigint, boolean)', '%is distinct from now()%_touch_chain_operational_activity%'),
    ('public._trg_touch_operational_activity_from_activity()', '%new.updated_by is not distinct from ''system'' then%return new;%touch_property_operational_activity(new.property_id, true)%_record_placeholder_dependent_activity%new.chain_node_id%'),
    ('public._trg_touch_operational_activity_from_property()', '%_record_placeholder_dependent_activity%'),
    ('public._trg_touch_operational_activity_from_counterparty()', '%_record_placeholder_dependent_activity%'),
    ('public._trg_touch_operational_activity_from_chain_node()', '%buyer_ready%_touch_chain_operational_activity(new.chain_id)%_record_placeholder_dependent_activity%'),
    ('public.property_lifecycle_chain_release_safe(bigint)', '%seller_side_unrepresented_since is not null%_property_is_managed%'),
    ('public.get_property_lifecycle_signals(bigint)', '%isManaged%hasPlaceholderDependants%'),
    ('public.execute_enter_dormancy_warning(bigint, text, jsonb)', '%record_property_lifecycle_transition_worker%'),
    ('public.list_dormancy_warning_notification_targets(bigint)', '%p.id = p_source_property_id%'),
    ('public.get_dormancy_warning_email_recipient(bigint)', '%buyer_ready%estate_agent%homeowner_only_updates = false%_is_placeholder_dependent_side_user(t.id, c.user_id)%'),
    ('public.can_confirm_property_still_active(bigint)', '%_is_placeholder_dependent_side_user%'),
    ('public.confirm_transaction_still_active(bigint)', '%for update%_is_placeholder_dependent_side_user%interval ''24 hours''%'),
    ('public.get_property_lifecycle_status(bigint)', '%_is_placeholder_dependent_side_user%'),
    ('public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb)', '%for update%seller_side_represented%when ''expire_dormancy_warning'' then%_property_placeholder_has_dependants%'),
    ('public.list_property_lifecycle_worker_candidates(integer)', '%next_evaluation_at <= now()%'),
    ('public.schedule_property_lifecycle_evaluation(bigint, timestamptz)', '%next_evaluation_at%')
  ) as v_check(signature, fingerprint)
  where not exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure(v_check.signature)
      and p.prosecdef
      and p.prosrc like v_check.fingerprint
  );

  if v_offenders is not null then
    raise exception
      'lifecycle_bounded_dormancy postflight: functions missing or unexpected (%)',
      array_to_string(v_offenders, ', ');
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.touch_property_operational_activity(bigint, boolean)')
      and p.prosrc ~* 'where\s+chain_id\s*='
  ) then
    raise exception 'lifecycle_bounded_dormancy postflight: touch_property_operational_activity still writes chain peers';
  end if;

  if to_regclass('public.property_lifecycle_states_next_evaluation_idx') is null then
    raise exception 'lifecycle_bounded_dormancy postflight: next_evaluation_at index missing';
  end if;

  select array_agg(v_check.table_name || '.' || v_check.trigger_name)
  into v_offenders
  from (values
    ('property_operational_identities', 'trg_lifecycle_refresh_seller_side'),
    ('property_ea_assignments', 'trg_lifecycle_refresh_seller_side'),
    ('property_counterparty_participants', 'trg_lifecycle_refresh_seller_side'),
    ('properties', 'trg_lifecycle_refresh_seller_side_insert'),
    ('properties', 'trg_lifecycle_refresh_seller_side_update'),
    ('property_lifecycle_states', 'trg_property_lifecycle_states_schedule'),
    ('chains', 'trg_chains_completion_schedule_lifecycle'),
    ('chain_nodes', 'trg_touch_operational_activity_from_chain_node')
  ) as v_check(table_name, trigger_name)
  where not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = to_regclass('public.' || v_check.table_name)
      and t.tgname = v_check.trigger_name
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  );

  if v_offenders is not null then
    raise exception
      'lifecycle_bounded_dormancy postflight: triggers missing or disabled (%)',
      array_to_string(v_offenders, ', ');
  end if;

  if not exists (
    select 1
    from information_schema.routines r
    join information_schema.parameters prm
      on prm.specific_schema = r.specific_schema
     and prm.specific_name = r.specific_name
    where r.routine_schema = 'public'
      and r.routine_name = 'get_dormancy_warning_email_recipient'
      and prm.parameter_mode = 'OUT'
      and prm.parameter_name = 'recipient_kind'
  ) then
    raise exception
      'lifecycle_bounded_dormancy postflight: get_dormancy_warning_email_recipient has no recipient_kind';
  end if;

  if has_function_privilege('anon', 'public.get_dormancy_warning_email_recipient(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.get_dormancy_warning_email_recipient(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public._refresh_property_seller_side_state(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public._record_placeholder_dependent_activity(bigint, text)', 'execute')
     or has_function_privilege('authenticated', 'public._is_placeholder_dependent_side_user(bigint, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._property_is_managed(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public._property_placeholder_anchor(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public._touch_chain_operational_activity(bigint)', 'execute')
     or has_function_privilege('anon', 'public.touch_property_operational_activity(bigint, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.touch_property_operational_activity(bigint, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.can_confirm_property_still_active(bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.schedule_property_lifecycle_evaluation(bigint, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.list_property_lifecycle_worker_candidates(integer)', 'execute')
     or has_function_privilege('anon', 'public.get_property_lifecycle_status(bigint)', 'execute')
     or has_function_privilege('anon', 'public.confirm_transaction_still_active(bigint)', 'execute')
  then
    raise exception 'lifecycle_bounded_dormancy postflight: unexpected client execute grants';
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    join public.properties p
      on p.id = pls.property_id
    left join public.chains c
      on c.id = p.chain_id
    where c.completed_at is null
      and pls.operational_state in ('dormancy_warning', 'dormant')
  ) then
    raise exception 'lifecycle_bounded_dormancy postflight: a legacy dormancy state remains outside completed chains';
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    join public.properties p
      on p.id = pls.property_id
    left join public.chains c
      on c.id = p.chain_id
    where c.completed_at is null
      and pls.operational_state = 'active'
      and pls.seller_side_unrepresented_since is not null
      and public._property_is_managed(pls.property_id)
  ) then
    raise exception 'lifecycle_bounded_dormancy postflight: a managed row still has a placeholder clock';
  end if;
end;
$$;
