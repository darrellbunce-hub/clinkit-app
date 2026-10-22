-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Estate Agent and homeowner identity confidentiality (Business Rules 3.4,
-- 9.8, 19.23).
--
-- A homeowner may see the Estate Agent assigned to represent them for their
-- own sale; authorised staff of the assigned branch keep their branch-scoped
-- access; nobody else may read another seller's agent identity, branch id,
-- branch name or assignment details, or another homeowner's name or email.
-- Being a buyer, a property member or a participant in the same chain grants
-- nothing. Generic status and timeline attribution ("Homeowner",
-- "Estate Agent") stays shared and is not touched here.
--
-- "Seller-side homeowner" is the existing rule used by the write RPCs
-- (assign_property_ea_branch, set_property_ea_update_permission,
-- homeowner_remove_ea): is_property_seller_side_homeowner, i.e. the active sale
-- identity holder, or the single active counterparty seller on a purchase.
-- No new role is introduced.
--
-- branch_id is identifying: ea_branch_directory / search_ea_branch_directory
-- return branch_id with the branch and company names to every authenticated
-- user (by design, for homeowner search). Any path that hands an unauthorised
-- user a branch_id therefore discloses the agent.
--
-- Paths narrowed here (all currently readable by any property member, and
-- property_members includes the counterparty buyer on a sale):
--   1. property_ea_assignments_select_scope (20260610170000): assignment rows,
--      including branch_id and homeowner_only_updates.
--   2. get_property_ea_branch_entry (20261010120000): branch and company names.
--   3. property_delink_events_select_involved (20260714160000): EA removal
--      events carry metadata.branch_id and were readable by any past or
--      present operational identity holder (the buyer on a purchase row) and
--      by staff of any branch ever assigned to the property (so a former
--      branch could identify its successor).
--   4. property_claim_metadata_select_scope (20260612000000): invite_email and
--      invite_display_name (the seller's email and name) and the originating
--      staff user id.
--
-- Paths 1 and 3 are also limited to current scope (Business Rules 24.7):
-- branch staff read only active assignment rows, and delink events without a
-- branch are readable only by current identity holders and the actively
-- assigned branch. Former-branch access to summaries, lifecycle states and
-- unclaimed property rows, and get_participation_delink_options, are in
-- 20261021130000. Activity actor attribution is a separate fix in
-- 20261021140000.
--
-- Reviewed and unchanged (see README.md, "Identity disclosure review"): the
-- SECURITY DEFINER readers of these tables, ea_operational_assignments
-- (active branch members), ea_branch_directory (public directory without
-- assignments), profiles / property_members / identities / counterparty /
-- delegates (own rows only), chain-level summaries and activities (no
-- identity columns; active-only helpers), property_ea_reconnection_events
-- and property_claim_invitations (no participant read path).
--
-- "Branch Access Ended" is not implemented anywhere yet (no revocation job,
-- activity or notice exists). When built it must be a branch-identifying
-- delink-style record (metadata.branch_id), which policy 3 already limits to
-- the represented seller and the affected branch, and never a row in
-- activities or a _notify_chain_participants_of_delink fan-out.
--
-- No rows are changed. No table grants change. INSERT/UPDATE/DELETE on
-- property_ea_assignments stay revoked (20261005120000).

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_qual text;
  v_src text;
  v_fn record;
begin
  if to_regprocedure('public.is_property_seller_side_homeowner(bigint)') is null
     or to_regprocedure('public.is_ea_assigned_to_property(bigint)') is null
     or to_regprocedure('public.get_property_ea_branch_entry(bigint)') is null
  then
    raise exception 'identity_confidentiality aborted: a required helper is missing';
  end if;

  -- 1) property_ea_assignments
  select pol.qual into v_qual
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_ea_assignments'
    and pol.policyname = 'property_ea_assignments_select_scope'
    and pol.cmd = 'SELECT';

  if v_qual is null or v_qual not like '%is_property_member(property_id)%' then
    raise exception 'identity_confidentiality aborted: property_ea_assignments_select_scope differs from 20260610170000';
  end if;

  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'property_ea_assignments'
      and pol.policyname <> 'property_ea_assignments_select_scope'
  ) then
    raise exception 'identity_confidentiality aborted: unexpected additional policy on property_ea_assignments';
  end if;

  -- 2) get_property_ea_branch_entry
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.get_property_ea_branch_entry(bigint)');

  if v_src not like '%public.is_property_member(a.property_id)%' then
    raise exception 'identity_confidentiality aborted: get_property_ea_branch_entry body differs from 20261010120000';
  end if;

  -- 3) property_delink_events
  select pol.qual into v_qual
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_delink_events'
    and pol.policyname = 'property_delink_events_select_involved'
    and pol.cmd = 'SELECT';

  if v_qual is null
     or v_qual not like '%poi.homeowner_user_id = auth.uid()%'
     or v_qual not like '%bm.user_id = auth.uid()%'
  then
    raise exception 'identity_confidentiality aborted: property_delink_events_select_involved differs from 20260714160000';
  end if;

  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'property_delink_events'
      and pol.policyname <> 'property_delink_events_select_involved'
  ) then
    raise exception 'identity_confidentiality aborted: unexpected additional policy on property_delink_events';
  end if;

  -- The new delink policy keys branch identity on metadata.branch_id. Refuse
  -- to install if any live writer records a branch under another key.
  for v_fn in
    select p.proname
    from pg_proc p
    inner join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ilike '%insert into public.property_delink_events%'
      and p.prosrc ~* 'branch'
      and p.prosrc not like '%''branch_id''%'
  loop
    raise exception 'identity_confidentiality aborted: % writes delink events with an unrecognised branch key', v_fn.proname;
  end loop;

  -- 4) property_claim_metadata
  select pol.qual into v_qual
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'property_claim_metadata'
    and pol.policyname = 'property_claim_metadata_select_scope'
    and pol.cmd = 'SELECT';

  if v_qual is null
     or v_qual not like '%is_property_member(property_id)%'
     or v_qual not like '%is_ea_assigned_to_property(property_id)%'
  then
    raise exception 'identity_confidentiality aborted: property_claim_metadata_select_scope differs from 20260612000000';
  end if;

  if exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'property_claim_metadata'
      and pol.policyname <> 'property_claim_metadata_select_scope'
  ) then
    raise exception 'identity_confidentiality aborted: unexpected additional policy on property_claim_metadata';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Assignment rows: own seller-side homeowner (active row) or assigned branch
-- ---------------------------------------------------------------------------

drop policy if exists property_ea_assignments_select_scope
  on public.property_ea_assignments;

create policy property_ea_assignments_select_scope
  on public.property_ea_assignments
  for select
  to authenticated
  using (
    property_ea_assignments.status = 'active'
    and (
      public.is_property_seller_side_homeowner(property_id)
      or exists (
        select 1
        from public.ea_branch_members bm
        where bm.branch_id = property_ea_assignments.branch_id
          and bm.user_id = auth.uid()
      )
    )
  );

comment on policy property_ea_assignments_select_scope on public.property_ea_assignments is
  'Business Rules 3.4 / 19.23 / 24.7. Active assignments only: the seller-side homeowner (is_property_seller_side_homeowner) sees the agent representing them; members of the assigned branch see their branch''s assignment. Revoked rows are retained for audit but are not readable by end users. Buyers, property members, other chain participants and former branches see nothing.';

-- ---------------------------------------------------------------------------
-- 2) Branch labels for an assignment: same rule
-- ---------------------------------------------------------------------------

create or replace function public.get_property_ea_branch_entry(
  p_property_id bigint
)
returns table (
  branch_id uuid,
  branch_name text,
  town_or_city text,
  postcode text,
  company_id uuid,
  company_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.name,
    b.town_or_city,
    b.postcode,
    c.id,
    c.name
  from public.property_ea_assignments a
  inner join public.ea_branches b
    on b.id = a.branch_id
  inner join public.ea_companies c
    on c.id = b.company_id
  where auth.uid() is not null
    and a.property_id = p_property_id
    and a.status = 'active'
    and (
      public.is_property_seller_side_homeowner(a.property_id)
      or exists (
        select 1
        from public.ea_branch_members bm
        where bm.branch_id = a.branch_id
          and bm.user_id = auth.uid()
      )
    )
  limit 1;
$$;

alter function public.get_property_ea_branch_entry(bigint) owner to postgres;

comment on function public.get_property_ea_branch_entry(bigint) is
  'Branch and company labels for a property''s active EA assignment. Business Rules 19.23: visible only to the seller-side homeowner it represents, or a member of the assigned branch, whether or not the branch is still directory-eligible.';

revoke all on function public.get_property_ea_branch_entry(bigint) from public, anon;
grant execute on function public.get_property_ea_branch_entry(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Delink events: branch-identifying rows only to the seller side and the
--    branch the event is about
-- ---------------------------------------------------------------------------

drop policy if exists property_delink_events_select_involved
  on public.property_delink_events;

create policy property_delink_events_select_involved
  on public.property_delink_events
  for select
  to authenticated
  using (
    property_delink_events.actor_user_id = auth.uid()
    or (
      -- Events that carry no branch identity: current operational identity
      -- holders and the currently assigned branch.
      coalesce(property_delink_events.metadata ->> 'branch_id', '') = ''
      and (
        exists (
          select 1
          from public.property_operational_identities poi
          where poi.property_id = property_delink_events.property_id
            and poi.homeowner_user_id = auth.uid()
            and poi.status = 'active'
        )
        or public.is_ea_assigned_to_property(property_delink_events.property_id)
      )
    )
    or (
      -- Events that identify a branch (removal, release, and in future
      -- Branch Access Ended): the seller side it represented, or that
      -- branch's own staff.
      coalesce(property_delink_events.metadata ->> 'branch_id', '') <> ''
      and (
        public.is_property_seller_side_homeowner(property_delink_events.property_id)
        or exists (
          select 1
          from public.ea_branch_members bm
          where bm.user_id = auth.uid()
            and bm.branch_id::text = property_delink_events.metadata ->> 'branch_id'
        )
      )
    )
  );

comment on policy property_delink_events_select_involved on public.property_delink_events is
  'Business Rules 3.4 / 19.23 / 24.7. The actor always sees their own event. Events without metadata.branch_id: current operational identity holders and the actively assigned branch (not former holders or former branches). Events that identify a branch: the current seller-side homeowner and that branch''s staff only, never the buyer, a former identity holder or another branch. Rows are retained for audit regardless.';

-- ---------------------------------------------------------------------------
-- 4) Claim metadata (seller's invite email and name): seller side or the
--    actively assigned branch
-- ---------------------------------------------------------------------------

drop policy if exists property_claim_metadata_select_scope
  on public.property_claim_metadata;

create policy property_claim_metadata_select_scope
  on public.property_claim_metadata
  for select
  to authenticated
  using (
    public.is_property_seller_side_homeowner(property_id)
    or public.is_ea_assigned_to_property(property_id)
  );

comment on policy property_claim_metadata_select_scope on public.property_claim_metadata is
  'Business Rules 3.4 / 3.6. invite_email and invite_display_name identify the seller; readable only by the seller-side homeowner and by staff of the actively assigned branch (which sends the invitation). Buyers and other property members cannot read it.';
