-- EA Branch Access post-migration verification — Development ONLY (read-only)
-- Target project: bbbsxzxcjkmpqsfvmhbo
-- Run AFTER applying 20260721100000_ea_branch_access_ownership_continuity.sql
--
-- Run this ENTIRE file as ONE query in the Supabase SQL Editor.
-- Returns a SINGLE summary row. Expect migration_complete = true and all checks passing.

with migration_objects as (
  select
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ea_branch_membership_events'
    ) as has_audit_table,
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'transfer_ea_branch_ownership'
    ) as has_transfer_rpc,
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'ea_branch_members'
        and t.tgname = 'ea_branch_owner_invariant_trigger'
    ) as has_owner_trigger,
    not has_table_privilege('authenticated', 'public.ea_branch_members', 'UPDATE')
      as authenticated_update_revoked,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'ea_branch_members'
        and policyname = 'ea_branch_members_update_admins'
    ) as update_policy_dropped,
    pg_get_functiondef(p.oid) ilike '%owner_invitation_not_allowed%'
      as create_invite_blocks_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_ea_branch_invitation'
  limit 1
),
owner_invariant as (
  select
    count(*)::integer as populated_branches,
    count(*) filter (where owner_count = 1)::integer as branches_with_exactly_one_owner,
    count(*) filter (where owner_count = 0)::integer as populated_branches_with_zero_owners,
    count(*) filter (where owner_count > 1)::integer as populated_branches_with_multiple_owners,
    coalesce(
      jsonb_agg(
        jsonb_build_object('branch_id', branch_id, 'owner_count', owner_count)
        order by owner_count desc
      ) filter (where owner_count <> 1),
      '[]'::jsonb
    ) as invariant_violations
  from (
    select
      bm.branch_id,
      count(*) filter (where bm.role = 'branch_admin')::integer as owner_count
    from public.ea_branch_members bm
    group by bm.branch_id
  ) per_branch
),
invitations as (
  select
    count(*) filter (
      where invite_role = 'branch_admin'
        and invitation_accepted_at is null
        and invitation_revoked_at is null
    )::integer as pending_owner_invites_remaining,
    count(*) filter (
      where invite_role = 'agent'
        and invitation_accepted_at is null
        and invitation_revoked_at is null
        and invitation_expires_at > now()
    )::integer as pending_staff_invites_active
  from public.ea_branch_invitations
),
audit as (
  select count(*)::integer as membership_event_count
  from public.ea_branch_membership_events
),
grants_check as (
  select
    has_table_privilege('authenticated', 'public.ea_branch_members', 'SELECT') as auth_can_select_members,
    has_table_privilege('authenticated', 'public.ea_branch_members', 'INSERT') as auth_can_insert_members,
    has_table_privilege('service_role', 'public.ea_branch_membership_events', 'INSERT') as service_can_insert_audit
)
select
  mo.*,
  oi.populated_branches,
  oi.branches_with_exactly_one_owner,
  oi.populated_branches_with_zero_owners,
  oi.populated_branches_with_multiple_owners,
  oi.invariant_violations,
  inv.pending_owner_invites_remaining,
  inv.pending_staff_invites_active,
  aud.membership_event_count,
  gc.auth_can_select_members,
  gc.auth_can_insert_members,
  gc.service_can_insert_audit,
  (
    mo.has_audit_table
    and mo.has_transfer_rpc
    and mo.has_owner_trigger
    and mo.authenticated_update_revoked
    and mo.update_policy_dropped
    and mo.create_invite_blocks_owner
    and oi.populated_branches_with_zero_owners = 0
    and oi.populated_branches_with_multiple_owners = 0
    and inv.pending_owner_invites_remaining = 0
    and gc.auth_can_select_members
    and gc.service_can_insert_audit
  ) as migration_complete,
  case
    when not mo.has_transfer_rpc then 'Missing transfer_ea_branch_ownership — re-run full migration.'
    when not mo.authenticated_update_revoked then 'authenticated still has UPDATE on ea_branch_members — re-run full migration.'
    when oi.populated_branches_with_multiple_owners > 0
      or oi.populated_branches_with_zero_owners > 0
      then 'Owner invariant violated on populated branches — investigate before integration tests.'
    when inv.pending_owner_invites_remaining > 0
      then 'Pending Owner invitations remain — review revocation step.'
    else 'Post-migration checks passed. Proceed to npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute'
  end as next_step
from migration_objects mo
cross join owner_invariant oi
cross join invitations inv
cross join audit aud
cross join grants_check gc;
