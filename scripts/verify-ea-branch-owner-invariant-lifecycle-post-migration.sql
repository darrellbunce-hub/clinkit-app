-- Read-only post-migration verification for 20260721110000_ea_branch_owner_invariant_lifecycle_fix.sql

with trigger_def as (
  select pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = '_enforce_ea_branch_owner_invariant'
  limit 1
),
transfer_def as (
  select pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'transfer_ea_branch_ownership'
  limit 1
),
owner_invariant as (
  select
    count(*) filter (where owner_count = 0)::integer as populated_branches_with_zero_owners,
    count(*) filter (where owner_count > 1)::integer as populated_branches_with_multiple_owners
  from (
    select
      bm.branch_id,
      count(*) filter (where bm.role = 'branch_admin')::integer as owner_count
    from public.ea_branch_members bm
    group by bm.branch_id
  ) per_branch
)
select
  td.definition ilike '%from public.ea_branches b%' as invariant_branch_exists_guard,
  tr.definition ilike '%set role = ''agent''%'
    and position('owner_left_branch' in tr.definition) > 0
    and position('delete from public.ea_branch_members' in tr.definition)
      > position('owner_left_branch' in tr.definition) as leave_demote_before_delete,
  oi.populated_branches_with_zero_owners,
  oi.populated_branches_with_multiple_owners,
  (
    td.definition ilike '%from public.ea_branches b%'
    and tr.definition ilike '%set role = ''agent''%'
    and position('owner_left_branch' in tr.definition) > 0
    and oi.populated_branches_with_zero_owners = 0
    and oi.populated_branches_with_multiple_owners = 0
  ) as lifecycle_fix_complete,
  case
    when not (td.definition ilike '%from public.ea_branches b%')
      then 'Invariant trigger missing branch-exists guard — re-apply corrective migration.'
    when oi.populated_branches_with_zero_owners > 0
      or oi.populated_branches_with_multiple_owners > 0
      then 'Populated branch Owner invariant violated — investigate before integration tests.'
    else 'Lifecycle fix verified. Run: npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute --cleanup-stale'
  end as next_step
from trigger_def td
cross join transfer_def tr
cross join owner_invariant oi;
