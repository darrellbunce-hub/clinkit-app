-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Branch entitlement revocation (blocker B5; Business Rules 25.26–25.37,
-- 25.44–25.47, 26.1–26.8). Requires 20261021120000 (seller-side assignment
-- and delink-event visibility); the preflight refuses to run without it.
--
-- When a branch's entitlement ends, every active assignment of the branch is
-- revoked with revocation_reason 'entitlement_expired', open claim
-- invitations on those properties are invalidated, and one
-- property_delink_events row per property records the neutral
-- 'branch_access_ended' notice (actor_type 'system', metadata.branch_id).
--
-- Why two codes: revoked assignment rows are readable only by service_role
-- after 20261021120000, so the exact reason ('entitlement_expired') stays in
-- the audit record. The delink event is readable by the represented
-- (seller-side) homeowner and current members of the named branch, so it
-- carries only the approved customer wording (25.33, 25.36). Billing detail
-- stays in ea_subscription_events (branch members and service_role).
--
-- Not done here (by design):
--   - no activities rows and no _notify_chain_participants_of_delink call,
--     so nothing reaches the shared chain timeline (25.27);
--   - no change to properties.status, claim metadata, identities or chain
--     topology: the chain and the homeowner's access are unchanged (25.28,
--     25.29); an EA-created property with no homeowner stays in the chain as
--     awaiting connection (25.31);
--   - no reconnection: the former branch must be appointed again (25.32,
--     B4 keeps reconnection disabled);
--   - no email (25.35).
--
-- Callers (app wiring, not implemented here; README B5 section):
--   - Stripe webhook, when reconcileStripeSubscription records an ended
--     subscription: revoke_ea_branch_access_after_entitlement_end(branch).
--   - Daily billing-health cron: reconcile_ea_branch_entitlement_access()
--     applies due grace expiry and revokes any branch that is no longer
--     entitled but still holds active assignments.
--
-- Both functions are idempotent (26.7) and run in one transaction per call
-- (26.8). Branches with no subscription row at all and active smoke-test
-- fixture branches are skipped and counted (README decision list).
--
-- Rollback: drop both functions; restore the two check constraints from
-- 20261005120000 and 20260714170000 only if no row uses the new codes.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  if to_regclass('public.property_ea_assignments') is null
     or to_regclass('public.property_delink_events') is null
     or to_regclass('public.property_claim_invitations') is null
     or to_regclass('public.ea_branch_subscriptions') is null
     or to_regclass('public.ea_branches') is null
     or to_regprocedure('public.is_ea_branch_commercially_entitled(uuid)') is null
     or to_regprocedure('public.apply_ea_branch_grace_expiry_if_due(uuid)') is null
     or to_regprocedure('public._revoke_open_property_claim_invitations(bigint)') is null
     or to_regprocedure('public.is_smoke_test_ea_branch(uuid)') is null
  then
    raise exception 'branch_entitlement_revocation aborted: a required object is missing';
  end if;

  if to_regprocedure('public.revoke_ea_branch_access_after_entitlement_end(uuid)') is not null
     or to_regprocedure('public.reconcile_ea_branch_entitlement_access()') is not null
  then
    raise exception 'branch_entitlement_revocation aborted: functions already exist';
  end if;

  -- 20261021120000 must be live: revoked assignments readable by no end user,
  -- branch-bearing delink events limited to the seller side and that branch.
  select pol.qual into v_def
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_ea_assignments'
    and pol.policyname = 'property_ea_assignments_select_scope';

  if v_def is null or v_def not like '%''active''%' or v_def not like '%is_property_seller_side_homeowner%' then
    raise exception 'branch_entitlement_revocation aborted: apply 20261021120000 first (assignment visibility)';
  end if;

  select pol.qual into v_def
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_delink_events'
    and pol.policyname = 'property_delink_events_select_involved';

  if v_def is null or v_def not like '%branch_id%' or v_def not like '%is_property_seller_side_homeowner%' then
    raise exception 'branch_entitlement_revocation aborted: apply 20261021120000 first (delink event visibility)';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.property_ea_assignments'::regclass
    and c.conname = 'property_ea_assignments_revocation_reason_check';

  if v_def is null or v_def like '%entitlement_expired%' then
    raise exception 'branch_entitlement_revocation aborted: revocation_reason check differs from 20261005120000';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'public.property_delink_events'::regclass
    and c.conname = 'property_delink_events_reason_code_check';

  if v_def is null or v_def like '%branch_access_ended%' then
    raise exception 'branch_entitlement_revocation aborted: reason_code check differs from 20260714170000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Reason codes
-- ---------------------------------------------------------------------------

alter table public.property_ea_assignments
  drop constraint property_ea_assignments_revocation_reason_check;

alter table public.property_ea_assignments
  add constraint property_ea_assignments_revocation_reason_check
  check (
    revocation_reason is null
    or revocation_reason in (
      'homeowner_removed_ea',
      'branch_left',
      'replaced',
      'homeowner_left_cascade',
      'branch_member_erased',
      'entitlement_expired',
      'unspecified'
    )
  );

comment on column public.property_ea_assignments.revocation_reason is
  'Why the assignment ended: homeowner_removed_ea, branch_left, replaced, homeowner_left_cascade, branch_member_erased, entitlement_expired (the branch''s subscription entitlement ended; Business Rules 25.27), or unspecified (archive and legacy paths). Null while active. Revoked rows are readable only by service_role.';

alter table public.property_delink_events
  drop constraint property_delink_events_reason_code_check;

alter table public.property_delink_events
  add constraint property_delink_events_reason_code_check
  check (
    reason_code in (
      'no_longer_moving',
      'wrong_property',
      'prefer_not_to_use_keynetic',
      'no_longer_need_agent',
      'wrong_branch_assigned',
      'added_by_mistake',
      'branch_no_longer_instructed',
      'duplicate_property',
      'wrong_homeowner_invited',
      'duplicate_invitation',
      'invitation_no_longer_required',
      'other',
      'branch_access_ended'
    )
  );

comment on column public.property_delink_events.reason_code is
  'Predefined de-link reason code only. No free-text user input. branch_access_ended is system-written when a branch''s entitlement ends and carries no billing detail (Business Rules 25.33, 25.36).';

-- ---------------------------------------------------------------------------
-- 2) Revoke one branch
-- ---------------------------------------------------------------------------

create function public.revoke_ea_branch_access_after_entitlement_end(
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_assignments integer := 0;
  v_invitations integer := 0;
begin
  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'branch_required');
  end if;

  -- Serialises the webhook and the cron for one branch.
  perform 1
  from public.ea_branches b
  where b.id = p_branch_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'branch_not_found');
  end if;

  if public.is_smoke_test_ea_branch(p_branch_id) then
    return jsonb_build_object('ok', true, 'skipped', 'smoke_test_fixture', 'assignments_revoked', 0, 'invitations_revoked', 0);
  end if;

  if not exists (
    select 1
    from public.ea_branch_subscriptions s
    where s.branch_id = p_branch_id
  ) then
    return jsonb_build_object('ok', true, 'skipped', 'no_subscription_history', 'assignments_revoked', 0, 'invitations_revoked', 0);
  end if;

  -- Recovered during grace, or a new subscription: nothing to revoke.
  if public.is_ea_branch_commercially_entitled(p_branch_id) then
    return jsonb_build_object('ok', true, 'skipped', 'entitled', 'assignments_revoked', 0, 'invitations_revoked', 0);
  end if;

  for v_row in
    select pea.id, pea.property_id, p.chain_id
    from public.property_ea_assignments pea
    inner join public.properties p
      on p.id = pea.property_id
    where pea.branch_id = p_branch_id
      and pea.status = 'active'
    order by pea.property_id
    for update of pea
  loop
    -- Only the assigned branch can issue a claim invitation (16.5, 16.6,
    -- 25.47); recovery is a new appointment, never an old link (25.31).
    v_invitations := v_invitations
      + coalesce(public._revoke_open_property_claim_invitations(v_row.property_id), 0);

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'entitlement_expired',
      updated_at = now()
    where id = v_row.id
      and status = 'active';

    if found then
      v_assignments := v_assignments + 1;

      insert into public.property_delink_events (
        property_id,
        chain_id,
        actor_user_id,
        actor_type,
        reason_code,
        metadata
      )
      values (
        v_row.property_id,
        v_row.chain_id,
        null,
        'system',
        'branch_access_ended',
        jsonb_build_object(
          'operation', 'branch_access_ended',
          'branch_id', p_branch_id
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'assignments_revoked', v_assignments,
    'invitations_revoked', v_invitations
  );
end;
$$;

alter function public.revoke_ea_branch_access_after_entitlement_end(uuid) owner to postgres;

comment on function public.revoke_ea_branch_access_after_entitlement_end(uuid) is
  'service_role only. When the branch is no longer commercially entitled, revokes its active assignments (entitlement_expired), invalidates open claim invitations on those properties and records one branch_access_ended delink event per property. Never writes activities or notifies the chain (Business Rules 25.27). Idempotent; skips smoke-test fixture branches and branches with no subscription history.';

revoke all on function public.revoke_ea_branch_access_after_entitlement_end(uuid) from public, anon, authenticated;
grant execute on function public.revoke_ea_branch_access_after_entitlement_end(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Daily reconciliation
-- ---------------------------------------------------------------------------

create function public.reconcile_ea_branch_entitlement_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
  v_branch_id uuid;
  v_result jsonb;
  v_grace_expired integer := 0;
  v_branches integer := 0;
  v_skipped integer := 0;
  v_assignments integer := 0;
  v_invitations integer := 0;
begin
  -- Grace expiry otherwise happens only when a summary or checkout is read.
  for v_subscription_id in
    select s.id
    from public.ea_branch_subscriptions s
    where s.entitlement_status = 'grace'
      and s.grace_ends_at is not null
      and s.grace_ends_at <= now()
      and s.ended_at is null
    order by s.id
  loop
    v_result := public.apply_ea_branch_grace_expiry_if_due(v_subscription_id);

    if coalesce((v_result ->> 'applied')::boolean, false) then
      v_grace_expired := v_grace_expired + 1;
    end if;
  end loop;

  for v_branch_id in
    select distinct pea.branch_id
    from public.property_ea_assignments pea
    where pea.status = 'active'
      and not public.is_ea_branch_commercially_entitled(pea.branch_id)
    order by pea.branch_id
  loop
    v_branches := v_branches + 1;
    v_result := public.revoke_ea_branch_access_after_entitlement_end(v_branch_id);

    if coalesce((v_result ->> 'ok')::boolean, false) is not true then
      raise exception 'reconcile_ea_branch_entitlement_access: %',
        coalesce(v_result ->> 'error', 'unknown');
    end if;

    if v_result ? 'skipped' then
      v_skipped := v_skipped + 1;
    end if;

    v_assignments := v_assignments + coalesce((v_result ->> 'assignments_revoked')::integer, 0);
    v_invitations := v_invitations + coalesce((v_result ->> 'invitations_revoked')::integer, 0);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'grace_expired', v_grace_expired,
    'unentitled_branches_with_assignments', v_branches,
    'branches_skipped', v_skipped,
    'assignments_revoked', v_assignments,
    'invitations_revoked', v_invitations
  );
end;
$$;

alter function public.reconcile_ea_branch_entitlement_access() owner to postgres;

comment on function public.reconcile_ea_branch_entitlement_access() is
  'service_role only, for the daily billing-health cron. Applies due grace expiry, then revokes access for every branch that is not commercially entitled but still holds active assignments. Returns counts only. Idempotent; one transaction per call.';

revoke all on function public.reconcile_ea_branch_entitlement_access() from public, anon, authenticated;
grant execute on function public.reconcile_ea_branch_entitlement_access() to service_role;

-- ---------------------------------------------------------------------------
-- 4) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_src text;
begin
  foreach v_fn in array array[
    'public.revoke_ea_branch_access_after_entitlement_end(uuid)',
    'public.reconcile_ea_branch_entitlement_access()'
  ]
  loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute')
    then
      raise exception 'branch_entitlement_revocation postflight: % grants differ', v_fn;
    end if;

    select p.prosrc into v_src
    from pg_proc p
    where p.oid = to_regprocedure(v_fn);

    if v_src like '%public.activities%'
       or v_src like '%_notify_chain_participants_of_delink%'
       or v_src like '%_insert_participation_delink_activity%'
       or v_src like '%property_lifecycle_transition%'
       or v_src like '%reconnect%'
    then
      raise exception 'branch_entitlement_revocation postflight: % reaches the shared timeline, lifecycle or reconnection', v_fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.property_ea_assignments'::regclass
      and c.conname = 'property_ea_assignments_revocation_reason_check'
      and pg_get_constraintdef(c.oid) like '%entitlement_expired%'
  ) or not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.property_delink_events'::regclass
      and c.conname = 'property_delink_events_reason_code_check'
      and pg_get_constraintdef(c.oid) like '%branch_access_ended%'
  ) then
    raise exception 'branch_entitlement_revocation postflight: reason codes not installed';
  end if;
end;
$$;
