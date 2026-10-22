-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Former-branch scope and delink-options authorisation (Business Rules 3.4,
-- 19.23, 24.7, 25.27). Apply after 20261021120000.
--
-- When a branch's assignment ends, the branch keeps no read access to
-- identifiable property information solely because it once managed the
-- property. Records are retained for audit; only end-user read access
-- changes. Current authorised users keep exactly the access they have today.
--
--   1. property_lifecycle_states_select_participant (20260714160000): the
--      extra branch clause had no status filter, so staff of any branch ever
--      assigned read lifecycle state forever. The policy becomes
--      is_property_operational_participant(property_id), which already admits
--      the actively assigned branch.
--   2. agent_branch_property_summaries (20261006120000): the owner view
--      returned revoked assignments (address, postcode, stage, alerts, claim
--      and invitation status) to the former branch. It now returns active
--      assignments only. Every other column and join is copied verbatim.
--   3. properties_select_member_or_agent (20260610227000): the creator
--      clause (creator, while the row has no members) let two people keep
--      reading a property only because they created it: the staff member who
--      originated an unclaimed EA property, after the branch's access ended
--      or after they left the branch; and a homeowner who created the row and
--      later left it (Business Rules 7.3, 24.7). The clause now applies only
--      while the row has no members and has never had an Estate Agent
--      assignment, an operational identity (any status) or a delink event,
--      i.e. only in the moment between a client insert and the grant that
--      follows it. Members and the actively assigned branch are admitted by
--      their own clauses.
--   4. get_participation_delink_options (20261005120000): returned
--      property_not_found for unknown ids and invitation_pending /
--      meaningful_participation for any property to any signed-in user. It
--      now answers only the operational homeowner, the seller-side homeowner
--      and the actively assigned branch; everyone else gets an identical empty
--      result. The invitation and participation signals go only to the seller
--      side and the assigned branch (the buyer holding a purchase row keeps
--      its own leave option). The panel and quick actions render nothing for
--      an empty list and the app never reads the signals, so legitimate
--      viewers see no change.
--
-- list_reconnectable_ea_properties (former branch address after a
-- homeowner_left_cascade revocation) is handled in 20261021150000.
--
-- No rows are changed. No table grants change.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_qual text;
  v_src text;
  v_def text;
  v_opts text[];
begin
  if to_regprocedure('public.is_property_operational_participant(bigint)') is null
     or to_regprocedure('public.is_ea_assigned_to_property(bigint)') is null
     or to_regprocedure('public.is_property_member(bigint)') is null
     or to_regprocedure('public.is_property_seller_side_homeowner(bigint)') is null
     or to_regprocedure('public.get_participation_delink_options(bigint)') is null
     or to_regclass('public.agent_branch_property_summaries') is null
     or to_regclass('public.property_operational_identities') is null
     or to_regclass('public.property_delink_events') is null
  then
    raise exception 'former_branch_scope aborted: a required object is missing';
  end if;

  -- 1) property_lifecycle_states
  select pol.qual into v_qual
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_lifecycle_states'
    and pol.policyname = 'property_lifecycle_states_select_participant'
    and pol.cmd = 'SELECT';

  if v_qual is null
     or v_qual not like '%is_property_operational_participant(property_id)%'
     or v_qual not like '%bm.user_id = auth.uid()%'
     or v_qual like '%status%'
  then
    raise exception 'former_branch_scope aborted: property_lifecycle_states_select_participant differs from 20260714160000';
  end if;

  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'property_lifecycle_states'
      and pol.cmd in ('SELECT', 'ALL')
      and pol.policyname <> 'property_lifecycle_states_select_participant'
  ) then
    raise exception 'former_branch_scope aborted: unexpected additional read policy on property_lifecycle_states';
  end if;

  -- 2) agent_branch_property_summaries
  select pg_get_viewdef('public.agent_branch_property_summaries'::regclass), c.reloptions
  into v_def, v_opts
  from pg_class c
  where c.oid = 'public.agent_branch_property_summaries'::regclass;

  if v_def not like '%''revoked''::text%'
     or v_def not like '%bm.user_id = auth.uid()%'
     or v_def not like '%activity_clock_source%'
     or not ('security_invoker=false' = any (coalesce(v_opts, array[]::text[])))
  then
    raise exception 'former_branch_scope aborted: agent_branch_property_summaries differs from 20261006120000';
  end if;

  -- 3) properties
  select pol.qual into v_qual
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'properties'
    and pol.policyname = 'properties_select_member_or_agent'
    and pol.cmd = 'SELECT';

  if v_qual is null
     or v_qual not like '%is_property_member(id)%'
     or v_qual not like '%is_ea_assigned_to_property(id)%'
     or v_qual not like '%created_by_user_id = auth.uid()%'
     or v_qual not like '%property_has_any_member(id)%'
  then
    raise exception 'former_branch_scope aborted: properties_select_member_or_agent differs from 20260610227000';
  end if;

  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'properties'
      and pol.cmd in ('SELECT', 'ALL')
      and pol.policyname <> 'properties_select_member_or_agent'
  ) then
    raise exception 'former_branch_scope aborted: unexpected additional read policy on properties';
  end if;

  if to_regprocedure('public.is_property_creator_bootstrap_viewer(bigint)') is not null then
    raise exception 'former_branch_scope aborted: is_property_creator_bootstrap_viewer already exists';
  end if;

  -- 4) get_participation_delink_options
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.get_participation_delink_options(bigint)');

  if v_src not like '%''property_not_found''%'
     or v_src not like '%v_is_seller_side_homeowner := public.is_property_seller_side_homeowner(p_property_id);%'
     or v_src not like '%''invitation_pending'', v_invitation_pending,%'
     or v_src not like '%public._ea_homeowner_withdrawal_status(p_property_id)%'
  then
    raise exception 'former_branch_scope aborted: get_participation_delink_options body differs from 20261005120000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Lifecycle states: current operational participants only
-- ---------------------------------------------------------------------------

drop policy if exists property_lifecycle_states_select_participant
  on public.property_lifecycle_states;

create policy property_lifecycle_states_select_participant
  on public.property_lifecycle_states
  for select
  to authenticated
  using (
    public.is_property_operational_participant(property_id)
  );

comment on policy property_lifecycle_states_select_participant on public.property_lifecycle_states is
  'Business Rules 24.7. Current operational participants (is_property_operational_participant), which includes the actively assigned branch. Former branches lose access; rows are retained.';

-- ---------------------------------------------------------------------------
-- 2) Branch dashboard: active assignments only (copied from 20261006120000)
-- ---------------------------------------------------------------------------

create or replace view public.agent_branch_property_summaries
with (security_invoker = false)
as
select
  pea.id as assignment_id,
  pea.property_id,
  pea.branch_id,
  pea.status as assignment_status,
  pea.homeowner_only_updates,
  pea.assigned_at,
  p.chain_id,
  p.address,
  p.postcode,
  p.stage,
  p.status as property_status,
  ch.completion_lifecycle_status,
  ch.completion_scheduled_date,
  ch.completed_at,
  pos.needs_attention,
  pos.stale_update,
  case
    when genuine.last_update_at is null then null
    else greatest(
      0,
      (now() at time zone 'Europe/London')::date
        - (genuine.last_update_at at time zone 'Europe/London')::date
    )
  end as days_since_last_update,
  pos.operational_alerts,
  pos.next_recommended_action,
  cos.confidence_score,
  cos.health_status,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  coalesce(pcm.origin_type, 'homeowner') as origin_type,
  case
    when coalesce(pcm.claim_status, 'claimed') = 'claimed' then 'claimed'
    when active_invitation.id is not null then 'invitation_active'
    when latest_invitation.invitation_rejected_at is not null then 'invitation_declined'
    when latest_invitation.id is not null
      and latest_invitation.invitation_revoked_at is null
      and latest_invitation.invitation_used_at is null
      and latest_invitation.invitation_expires_at <= now() then 'invitation_expired'
    when coalesce(pcm.invitation_deferred, false) then 'invitation_deferred'
    else 'awaiting_claim'
  end as invitation_lifecycle_status,
  active_invitation.invitation_expires_at,
  active_invitation.invitation_version,
  latest_invitation.invitation_rejected_at,
  latest_invitation.invitation_rejection_reason,
  nullif(trim(pcm.invite_email), '') as invite_email,
  latest_invitation.invitation_rejection_acknowledged_at,
  cos.confidence_band,
  cos.confidence_unavailable,
  cos.estimated_completion_window,
  cos.data_coverage_status,
  cos.coverage_label,
  cos.next_recalculation_at,
  cos.confidence_algorithm_version,
  cos.eta_algorithm_version,
  genuine.last_update_at,
  public.operational_summary_state(
    cos.chain_id is not null,
    pos.property_id is not null,
    refresh_queue.chain_id is not null,
    cos.next_recalculation_at,
    least(cos.summary_version, pos.summary_version)
  ) as summary_state,
  cos.computed_at as summary_computed_at,
  coalesce(genuine.last_update_at, clock_fallback.fallback_at) as activity_clock_at,
  case
    when genuine.last_update_at is not null then 'genuine_activity'
    else clock_fallback.fallback_source
  end as activity_clock_source
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
left join public.chain_operational_refresh_queue refresh_queue
  on refresh_queue.chain_id = p.chain_id
left join public.property_operational_clock_fallback clock_fallback
  on clock_fallback.property_id = pea.property_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
left join lateral (
  -- A revoked branch sees activity only up to its revocation.
  select max(a."timestamp") as last_update_at
  from public.activities a
  where a.property_id = pea.property_id
    and public.is_genuine_property_activity(a.update, a.updated_by)
    and (
      pea.status = 'active'
      or pea.revoked_at is null
      or a."timestamp" <= pea.revoked_at
    )
) genuine on true
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
    and pci.invitation_revoked_at is null
    and pci.invitation_used_at is null
    and pci.invitation_expires_at > now()
  order by pci.invitation_created_at desc
  limit 1
) active_invitation on true
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
  order by pci.invitation_created_at desc
  limit 1
) latest_invitation on true
where
  auth.uid() is not null
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  )
  and pea.status = 'active';

comment on view public.agent_branch_property_summaries is
  'Branch-scoped property assignment summaries with cached operational intelligence. last_update_at is the latest genuine operational activity (is_genuine_property_activity); days_since_last_update is its Europe/London calendar-day age; both are NULL without genuine activity. summary_state is missing, stale or fresh (operational_summary_state). activity_clock_at is the live staleness clock: genuine activity, else the documented fallback. Business Rules 24.7: active assignments only; revoked assignments are retained for audit but not shown to the former branch.';

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Property rows: creator bootstrap only before any grant or history
-- ---------------------------------------------------------------------------

create or replace function public.is_property_creator_bootstrap_viewer(
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
      from public.properties p
      where p.id = p_property_id
        and p.created_by_user_id = auth.uid()
        and not exists (
          select 1
          from public.property_members pm
          where pm.property_id = p.id
        )
        and not exists (
          select 1
          from public.property_ea_assignments pea
          where pea.property_id = p.id
        )
        and not exists (
          select 1
          from public.property_operational_identities poi
          where poi.property_id = p.id
        )
        and not exists (
          select 1
          from public.property_delink_events pde
          where pde.property_id = p.id
        )
    );
$$;

alter function public.is_property_creator_bootstrap_viewer(bigint) owner to postgres;

comment on function public.is_property_creator_bootstrap_viewer(bigint) is
  'RLS helper: the caller created the property, it has no members, and it has never had an Estate Agent assignment, an operational identity or a delink event (the moment between a client insert and its grant). A creator who left, or whose branch lost access, is not admitted (Business Rules 7.3, 24.7). True only for the caller''s own rows, so it is not an oracle for other properties.';

revoke all on function public.is_property_creator_bootstrap_viewer(bigint) from public, anon;
grant execute on function public.is_property_creator_bootstrap_viewer(bigint) to authenticated, service_role;

drop policy if exists properties_select_member_or_agent
  on public.properties;

create policy properties_select_member_or_agent
  on public.properties
  for select
  to authenticated
  using (
    public.is_property_member(id)
    or public.is_ea_assigned_to_property(id)
    or public.is_property_creator_bootstrap_viewer(id)
  );

comment on policy properties_select_member_or_agent on public.properties is
  'Members, the actively assigned branch, or the creator while the row has no members and has never had an assignment, identity or delink event (Business Rules 7.3, 24.7: a former branch, an originating staff member who left, or a homeowner who left cannot keep reading the row).';

-- ---------------------------------------------------------------------------
-- 4) Delink options: answer only callers with a role on the property
--    (copied from 20261005120000)
-- ---------------------------------------------------------------------------

create or replace function public.get_participation_delink_options(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_options jsonb := '[]'::jsonb;
  v_branch_id uuid;
  v_caller_branch_id uuid;
  v_is_homeowner boolean;
  v_is_seller_side_homeowner boolean;
  v_has_ea boolean;
  v_invitation_pending boolean;
  v_meaningful boolean;
  v_withdrawal text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  )
  into v_is_homeowner;

  v_is_seller_side_homeowner := public.is_property_seller_side_homeowner(p_property_id);

  select pea.branch_id
  into v_branch_id
  from public.property_ea_assignments pea
  where pea.property_id = p_property_id
    and pea.status = 'active'
  limit 1;

  v_has_ea := v_branch_id is not null;

  select pea.branch_id
  into v_caller_branch_id
  from public.property_ea_assignments pea
  inner join public.ea_branch_members bm
    on bm.branch_id = pea.branch_id
  where pea.property_id = p_property_id
    and pea.status = 'active'
    and bm.user_id = auth.uid()
  limit 1;

  -- Business Rules 3.4 / 19.23: only the operational homeowner, the
  -- seller-side homeowner and the actively assigned branch learn anything.
  -- Everyone else, and every id that does not exist, gets the same empty
  -- answer, so the RPC is not an existence, invitation or branch oracle.
  if not (
    coalesce(v_is_homeowner, false)
    or coalesce(v_is_seller_side_homeowner, false)
    or v_caller_branch_id is not null
  ) then
    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'options', '[]'::jsonb,
      'signals', jsonb_build_object(
        'invitation_pending', false,
        'meaningful_participation', false,
        'is_operational_homeowner', false
      )
    );
  end if;

  v_invitation_pending :=
    public.property_invitation_is_pending(p_property_id);

  v_meaningful :=
    public.homeowner_has_meaningful_participation(p_property_id);

  if v_is_homeowner then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'homeowner_self',
        'label', 'Leave this transaction',
        'requires_confirmation', true,
        'branch_id', null,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('homeowner_self')
        )
      )
    );
  end if;

  if v_is_seller_side_homeowner and v_has_ea then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'homeowner_remove_ea',
        'label', 'Remove estate agent',
        'requires_confirmation', true,
        'branch_id', v_branch_id,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('homeowner_remove_ea')
        )
      )
    );
  end if;

  if v_caller_branch_id is not null then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'estate_agent_remove_branch',
        'label', 'Release branch management',
        'requires_confirmation', true,
        'branch_id', v_caller_branch_id,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('estate_agent_remove_branch')
        )
      )
    );

    v_withdrawal := public._ea_homeowner_withdrawal_status(p_property_id);

    if v_withdrawal in ('invitation_pending', 'removable') then
      v_options := v_options || jsonb_build_array(
        jsonb_build_object(
          'operation', 'estate_agent_remove_homeowner',
          'label', 'Withdraw homeowner association',
          'requires_confirmation', true,
          'branch_id', v_caller_branch_id,
          'invitation_pending', v_withdrawal = 'invitation_pending',
          'reason_codes', to_jsonb(
            public.participation_delink_reason_codes_for_operation('estate_agent_remove_homeowner')
          )
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'options', v_options,
    'signals', jsonb_build_object(
      -- Invitation and participation signals describe the seller side; the
      -- buyer who holds a purchase row gets only their own leave option.
      'invitation_pending',
        (coalesce(v_is_seller_side_homeowner, false) or v_caller_branch_id is not null)
        and v_invitation_pending,
      'meaningful_participation',
        (coalesce(v_is_seller_side_homeowner, false) or v_caller_branch_id is not null)
        and v_meaningful,
      'is_operational_homeowner', v_is_homeowner
    )
  );
end;
$$;

comment on function public.get_participation_delink_options(bigint) is
  'Participation de-link options for the caller. Mirrors _execute_participation_delink: homeowner_remove_ea for the seller-side homeowner only; estate_agent_remove_homeowner for the assigned branch per _ea_homeowner_withdrawal_status. Callers with none of these roles, and unknown ids, receive an identical empty result (no existence, invitation or branch signal).';

alter function public.get_participation_delink_options(bigint) owner to postgres;

revoke all on function public.get_participation_delink_options(bigint) from public, anon;
grant execute on function public.get_participation_delink_options(bigint) to authenticated, service_role;
