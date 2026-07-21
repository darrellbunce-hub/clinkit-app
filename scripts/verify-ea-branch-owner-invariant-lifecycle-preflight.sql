-- Read-only preflight for 20260721110000_ea_branch_owner_invariant_lifecycle_fix.sql
-- Run BEFORE applying the corrective migration on Development.

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
)
select
  (td.definition ilike '%from public.ea_branches b%') as invariant_checks_branch_exists,
  (td.definition not ilike '%from public.ea_branches b%') as invariant_missing_branch_guard,
  (tr.definition ilike '%owner_left_branch%'
    and tr.definition ilike '%set role = ''agent''%'
    and tr.definition ilike '%delete from public.ea_branch_members%') as leave_path_demotes_before_delete,
  case
    when td.definition ilike '%from public.ea_branches b%'
      and tr.definition ilike '%owner_left_branch%'
      and tr.definition ilike '%set role = ''agent''%'
      then 'Corrective migration already applied — proceed to post-migration verification and integration suite.'
    else 'Apply supabase/migrations/20260721110000_ea_branch_owner_invariant_lifecycle_fix.sql, then run verify-ea-branch-owner-invariant-lifecycle-post-migration.sql.'
  end as next_step
from trigger_def td
cross join transfer_def tr;
