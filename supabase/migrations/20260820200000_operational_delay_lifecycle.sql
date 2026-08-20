-- Operational delay lifecycle (ACTIVE → RESOLVED)
--
-- Authoritative delay state lives in public.operational_delays.
-- Timeline/history activities remain event records only; active/resolved
-- must NOT depend solely on parsing activity text.
--
-- Privacy: structured reasons only — no free-text description/notes.
-- Migration policy: do NOT invent active delays or resolution dates from
-- historical "Delay Reported" activity rows (unsafe / ambiguous). Preserve
-- those activities as history; explicit lifecycle starts from this feature.

-- ---------------------------------------------------------------------------
-- Prerequisite: Phase 5a chain delegated-editor helper
-- ---------------------------------------------------------------------------
-- Development has public.is_ea_delegated_editor_on_property(bigint) (restored
-- by 20260713130000 after Phase 5a helpers were absent), but is missing the
-- sibling public.is_ea_delegated_editor_on_chain(bigint) from
-- 20260610300000_phase5a_ea_delegated_mutations.sql.
--
-- Restore the canonical Phase 5a definition only — same signature, same
-- assignment + homeowner_only_updates = false semantics. Do not invent a
-- differently named helper or weaken to view-only assignment checks.

create or replace function public.is_ea_delegated_editor_on_chain(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.properties p
      on p.id = pea.property_id
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where p.chain_id = p_chain_id
      and pea.status = 'active'
      and pea.homeowner_only_updates = false
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_delegated_editor_on_chain(bigint) is
  'True when the current user may post delegated updates on any assigned property in the chain.';

revoke all on function public.is_ea_delegated_editor_on_chain(bigint) from public;
grant execute on function public.is_ea_delegated_editor_on_chain(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.operational_delays (
  id bigint generated always as identity primary key,
  chain_id bigint not null references public.chains (id),
  property_id bigint null references public.properties (id),
  chain_node_id bigint null references public.chain_nodes (id),
  reason text not null,
  status text not null,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz null,
  created_by_user_id uuid null,
  resolved_by_user_id uuid null,
  created_by_role text null,
  resolved_by_role text null,
  constraint operational_delays_status_check
    check (status in ('active', 'resolved')),
  constraint operational_delays_reason_check
    check (
      reason in (
        'Awaiting Searches',
        'Awaiting Mortgage Offer',
        'Awaiting Signed Documents',
        'Awaiting Survey Results',
        'Awaiting Management Pack'
      )
    ),
  constraint operational_delays_target_xor_check
    check (
      (property_id is not null and chain_node_id is null)
      or (property_id is null and chain_node_id is not null)
    ),
  constraint operational_delays_resolved_at_check
    check (
      (status = 'active' and resolved_at is null)
      or (status = 'resolved' and resolved_at is not null)
    )
);

comment on table public.operational_delays is
  'Authoritative operational delay lifecycle (active/resolved). Structured reasons only; no free text.';

create unique index if not exists operational_delays_one_active_per_property
  on public.operational_delays (property_id)
  where status = 'active' and property_id is not null;

create unique index if not exists operational_delays_one_active_per_chain_node
  on public.operational_delays (chain_node_id)
  where status = 'active' and chain_node_id is not null;

create index if not exists operational_delays_chain_status_idx
  on public.operational_delays (chain_id, status);

create index if not exists operational_delays_property_idx
  on public.operational_delays (property_id)
  where property_id is not null;

create index if not exists operational_delays_chain_node_idx
  on public.operational_delays (chain_node_id)
  where chain_node_id is not null;

alter table public.operational_delays enable row level security;

-- SELECT: same visibility as activities — chain participants (and EA delegated editors).
drop policy if exists operational_delays_select_participant
  on public.operational_delays;

create policy operational_delays_select_participant
  on public.operational_delays
  for select
  to authenticated
  using (
    public.is_chain_participant(chain_id)
    or public.is_ea_delegated_editor_on_chain(chain_id)
  );

-- Mutations only via SECURITY DEFINER RPCs.
revoke all on table public.operational_delays from public;
revoke all on table public.operational_delays from anon;
revoke insert, update, delete on table public.operational_delays from authenticated;
grant select on table public.operational_delays to authenticated;
grant all on table public.operational_delays to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_valid_operational_delay_reason(
  p_reason text
)
returns boolean
language sql
immutable
as $$
  select p_reason in (
    'Awaiting Searches',
    'Awaiting Mortgage Offer',
    'Awaiting Signed Documents',
    'Awaiting Survey Results',
    'Awaiting Management Pack'
  );
$$;

comment on function public.is_valid_operational_delay_reason(text) is
  'True when the delay reason is one of the predefined structured values (no free text).';

revoke all on function public.is_valid_operational_delay_reason(text) from public;
grant execute on function public.is_valid_operational_delay_reason(text) to authenticated;
grant execute on function public.is_valid_operational_delay_reason(text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: report_operational_delay
-- ---------------------------------------------------------------------------

create or replace function public.report_operational_delay(
  p_reason text,
  p_property_id bigint default null,
  p_chain_node_id bigint default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_node public.chain_nodes%rowtype;
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_valid_operational_delay_reason(p_reason) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if (p_property_id is null and p_chain_node_id is null)
     or (p_property_id is not null and p_chain_node_id is not null) then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  v_actor_role := nullif(btrim(coalesce(p_actor_role, '')), '');

  if p_property_id is not null then
    select * into v_property
    from public.properties
    where id = p_property_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'property_not_found');
    end if;

    if not (
      public.is_property_member(p_property_id)
      or public.is_ea_delegated_editor_on_property(p_property_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    v_chain_id := v_property.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.property_id = p_property_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  else
    select * into v_node
    from public.chain_nodes
    where id = p_chain_node_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'chain_node_not_found');
    end if;

    if v_node.node_type is distinct from 'buyer_ready' then
      return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;

    if not (
      public.is_chain_participant(v_node.chain_id)
      or public.is_ea_delegated_editor_on_chain(v_node.chain_id)
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    v_chain_id := v_node.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.chain_node_id = p_chain_node_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  end if;

  v_activity_message := 'Delay reported — ' || p_reason;

  insert into public.operational_delays (
    chain_id,
    property_id,
    chain_node_id,
    reason,
    status,
    created_by_user_id,
    created_by_role
  )
  values (
    v_chain_id,
    p_property_id,
    p_chain_node_id,
    p_reason,
    'active',
    v_uid,
    v_actor_role
  )
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    p_property_id,
    p_chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'created_at', v_delay.created_at,
    'activity_message', v_activity_message
  );
end;
$$;

comment on function public.report_operational_delay(text, bigint, bigint, text) is
  'Create an ACTIVE structured operational delay and timeline activity. No free text.';

revoke all on function public.report_operational_delay(text, bigint, bigint, text) from public;
grant execute on function public.report_operational_delay(text, bigint, bigint, text) to authenticated;
grant execute on function public.report_operational_delay(text, bigint, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: resolve_operational_delay
-- ---------------------------------------------------------------------------

create or replace function public.resolve_operational_delay(
  p_delay_id bigint,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
  v_allowed boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_delay
  from public.operational_delays
  where id = p_delay_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'delay_not_found');
  end if;

  -- Idempotent: already resolved — do not corrupt state or insert duplicate activity.
  if v_delay.status = 'resolved' then
    return jsonb_build_object(
      'ok', true,
      'delay_id', v_delay.id,
      'status', 'resolved',
      'reason', v_delay.reason,
      'resolved_at', v_delay.resolved_at,
      'already_resolved', true
    );
  end if;

  if v_delay.property_id is not null then
    v_allowed :=
      public.is_property_member(v_delay.property_id)
      or public.is_ea_delegated_editor_on_property(v_delay.property_id);
  elsif v_delay.chain_node_id is not null then
    v_allowed :=
      public.is_chain_participant(v_delay.chain_id)
      or public.is_ea_delegated_editor_on_chain(v_delay.chain_id);
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_actor_role := nullif(btrim(coalesce(p_actor_role, '')), '');
  v_activity_message := 'Delay resolved — ' || v_delay.reason;

  update public.operational_delays
  set
    status = 'resolved',
    resolved_at = timezone('utc', now()),
    resolved_by_user_id = v_uid,
    resolved_by_role = v_actor_role
  where id = v_delay.id
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    v_delay.property_id,
    v_delay.chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'resolved_at', v_delay.resolved_at,
    'activity_message', v_activity_message,
    'already_resolved', false
  );
end;
$$;

comment on function public.resolve_operational_delay(bigint, text) is
  'Resolve an ACTIVE operational delay. Idempotent; retains history; inserts resolve timeline activity.';

revoke all on function public.resolve_operational_delay(bigint, text) from public;
grant execute on function public.resolve_operational_delay(bigint, text) to authenticated;
grant execute on function public.resolve_operational_delay(bigint, text) to service_role;
