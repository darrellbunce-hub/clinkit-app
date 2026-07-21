-- EA Branch Access migration preflight — Development ONLY (read-only)
-- Target project: bbbsxzxcjkmpqsfvmhbo
-- Migration: supabase/migrations/20260721100000_ea_branch_access_ownership_continuity.sql
--
-- Run this ENTIRE file as ONE query in the Supabase SQL Editor (Development project).
-- Returns a SINGLE summary row with recommended_action.
--
-- recommended_action values:
--   APPLY_MIGRATION       → prerequisites met; safe to run the full migration file
--   ALREADY_COMPLETE      → migration appears applied; skip migration, run post-migration checks
--   BLOCKED_PREREQUISITES → EA team tables missing; apply earlier migrations first
--   REVIEW_BEFORE_APPLY   → data anomalies need manual review (see detail columns)
--   PARTIAL_APPLY         → incomplete apply detected; re-run FULL migration file (idempotent)
--   UNEXPECTED_STATE      → manual investigation required

with prerequisite as (
  select
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ea_branch_members'
    ) as has_ea_branch_members,
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ea_branch_invitations'
    ) as has_ea_branch_invitations,
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ea_branches'
    ) as has_ea_branches,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'remove_ea_branch_member'
    ) as has_remove_ea_branch_member,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_ea_branch_invitation'
    ) as has_create_ea_branch_invitation
),
migration_state as (
  select
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'ea_branch_membership_events'
    ) as has_membership_events_table,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'transfer_ea_branch_ownership'
    ) as has_transfer_rpc,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_enforce_ea_branch_owner_invariant'
    ) as has_owner_invariant_fn,
    exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'ea_branch_members'
        and t.tgname = 'ea_branch_owner_invariant_trigger'
        and t.tgdeferrable
        and t.tginitdeferred
    ) as has_deferred_owner_trigger,
    not has_table_privilege('authenticated', 'public.ea_branch_members', 'UPDATE')
      as authenticated_update_revoked,
    not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'ea_branch_members'
        and policyname = 'ea_branch_members_update_admins'
    ) as update_policy_dropped,
    coalesce(
      (
        select pg_get_functiondef(p.oid) not ilike '%is_ea_branch_founder%'
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_ea_branch_team_manager'
        limit 1
      ),
      false
    ) as team_manager_without_founder
),
branch_counts as (
  select
    count(*)::integer as total_branches,
    count(*) filter (
      where not exists (
        select 1 from public.ea_branch_members bm where bm.branch_id = b.id
      )
    )::integer as zero_member_branches,
    count(*) filter (
      where exists (
        select 1 from public.ea_branch_members bm where bm.branch_id = b.id
      )
    )::integer as populated_branches
  from public.ea_branches b
),
membership_health as (
  select
    count(distinct bm.branch_id)::integer as branches_with_members,
    count(*) filter (where bm.role = 'branch_admin')::integer as total_owner_rows,
    count(*) filter (where bm.role = 'agent')::integer as total_staff_rows,
    count(*)::integer as total_membership_rows
  from public.ea_branch_members bm
),
owner_distribution as (
  select
    count(*)::integer as branches_with_multiple_owners,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'branch_id', x.branch_id,
          'owner_count', x.owner_count,
          'owner_user_ids', x.owner_user_ids
        )
        order by x.owner_count desc
      ) filter (where x.branch_id is not null),
      '[]'::jsonb
    ) as duplicate_owner_branches
  from (
    select
      bm.branch_id,
      count(*)::integer as owner_count,
      jsonb_agg(bm.user_id order by bm.joined_at asc, bm.id asc) as owner_user_ids
    from public.ea_branch_members bm
    where bm.role = 'branch_admin'
    group by bm.branch_id
    having count(*) > 1
  ) x
),
branches_missing_owner as (
  select
    count(*)::integer as branches_with_members_but_no_owner,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'branch_id', y.branch_id,
          'member_count', y.member_count,
          'roles', y.roles
        )
        order by y.member_count desc
      ) filter (where y.branch_id is not null),
      '[]'::jsonb
    ) as missing_owner_branch_details
  from (
    select
      bm.branch_id,
      count(*)::integer as member_count,
      jsonb_agg(distinct bm.role) as roles
    from public.ea_branch_members bm
    group by bm.branch_id
    having count(*) filter (where bm.role = 'branch_admin') = 0
  ) y
),
repair_simulation as (
  select
    count(*)::integer as duplicate_owners_to_demote
  from (
    select bm.id
    from public.ea_branch_members bm
    join (
      select
        branch_id,
        id,
        row_number() over (
          partition by branch_id
          order by joined_at asc, id asc
        ) as owner_rank
      from public.ea_branch_members
      where role = 'branch_admin'
    ) ranked on ranked.id = bm.id
    where ranked.owner_rank > 1
  ) demote_ids
),
repair_simulation_missing as (
  select
    count(*)::integer as members_promoted_to_owner
  from (
    select distinct on (bm.branch_id) bm.id
    from public.ea_branch_members bm
    where bm.branch_id in (
      select branch_id
      from public.ea_branch_members
      group by branch_id
      having count(*) filter (where role = 'branch_admin') = 0
    )
    order by bm.branch_id, bm.joined_at asc, bm.id asc
  ) promote_ids
),
invitation_health as (
  select
    count(*) filter (
      where inv.invite_role = 'branch_admin'
        and inv.invitation_accepted_at is null
        and inv.invitation_revoked_at is null
    )::integer as pending_owner_invitations,
    count(*) filter (
      where inv.invite_role = 'branch_admin'
        and inv.invitation_accepted_at is null
        and inv.invitation_revoked_at is null
        and inv.invitation_expires_at > now()
    )::integer as pending_active_owner_invitations,
    count(*) filter (
      where inv.invite_role = 'agent'
        and inv.invitation_accepted_at is null
        and inv.invitation_revoked_at is null
        and inv.invitation_expires_at > now()
    )::integer as pending_active_staff_invitations
  from public.ea_branch_invitations inv
),
post_repair_owner_counts as (
  select
    count(*)::integer as branches_still_missing_owner_after_repair
  from (
    select bm.branch_id
    from public.ea_branch_members bm
    group by bm.branch_id
    having count(*) > 0
       and count(*) filter (where bm.role = 'branch_admin') = 0
  ) unresolved
),
orphan_branch_risk as (
  select
    count(*)::integer as zero_member_branch_count,
    'Zero-member branches skip the Owner invariant until first membership INSERT. First member must be branch_admin (founding) or branch must already have an Owner before Staff invitation accept.' as note
  from public.ea_branches b
  where not exists (
    select 1 from public.ea_branch_members bm where bm.branch_id = b.id
  )
)
select
  p.has_ea_branch_members,
  p.has_ea_branch_invitations,
  p.has_ea_branches,
  p.has_remove_ea_branch_member,
  p.has_create_ea_branch_invitation,
  (p.has_ea_branch_members and p.has_ea_branch_invitations and p.has_remove_ea_branch_member)
    as prerequisites_met,

  ms.has_membership_events_table,
  ms.has_transfer_rpc,
  ms.has_owner_invariant_fn,
  ms.has_deferred_owner_trigger,
  ms.authenticated_update_revoked,
  ms.update_policy_dropped,
  ms.team_manager_without_founder,
  (
    ms.has_membership_events_table
    and ms.has_transfer_rpc
    and ms.has_owner_invariant_fn
    and ms.has_deferred_owner_trigger
    and ms.authenticated_update_revoked
    and ms.update_policy_dropped
    and ms.team_manager_without_founder
  ) as migration_fully_applied,

  bc.total_branches,
  bc.zero_member_branches,
  bc.populated_branches,
  mh.branches_with_members,
  mh.total_owner_rows,
  mh.total_staff_rows,
  mh.total_membership_rows,

  od.branches_with_multiple_owners,
  od.duplicate_owner_branches,
  rs.duplicate_owners_to_demote,

  bmo.branches_with_members_but_no_owner,
  bmo.missing_owner_branch_details,
  rsm.members_promoted_to_owner,
  prc.branches_still_missing_owner_after_repair,

  ih.pending_owner_invitations,
  ih.pending_active_owner_invitations,
  ih.pending_active_staff_invitations,

  obr.zero_member_branch_count,
  obr.note as zero_member_branch_note,

  case
    when not (p.has_ea_branch_members and p.has_ea_branch_invitations and p.has_remove_ea_branch_member)
      then 'BLOCKED_PREREQUISITES'

    when (
      ms.has_membership_events_table
      and ms.has_transfer_rpc
      and ms.has_deferred_owner_trigger
      and ms.authenticated_update_revoked
    ) then 'ALREADY_COMPLETE'

    when (
      ms.has_membership_events_table
      or ms.has_transfer_rpc
    ) and not (
      ms.has_membership_events_table
      and ms.has_transfer_rpc
      and ms.has_deferred_owner_trigger
      and ms.authenticated_update_revoked
    ) then 'PARTIAL_APPLY'

    when not (p.has_ea_branch_members and p.has_ea_branch_invitations)
      then 'UNEXPECTED_STATE'

    else 'APPLY_MIGRATION'
  end as recommended_action,

  case
    when not (p.has_ea_branch_members and p.has_ea_branch_invitations and p.has_remove_ea_branch_member)
      then 'Apply earlier EA team migrations (through 20260712210000) before Workstream 1 migration.'

    when (
      ms.has_membership_events_table
      and ms.has_transfer_rpc
      and ms.authenticated_update_revoked
    ) then 'Migration appears complete. Run post-migration SQL + integration script; do not re-run unless PARTIAL_APPLY.'

    when (
      ms.has_membership_events_table
      or ms.has_transfer_rpc
    ) and not ms.authenticated_update_revoked
      then 'Partial apply detected. Re-run the FULL migration file in one SQL Editor execution.'

    when od.branches_with_multiple_owners > 0 or bmo.branches_with_members_but_no_owner > 0
      then 'Data repair will run during migration: duplicate Owners demoted by earliest joined_at,id; missing Owner promoted from earliest member. No Staff rows deleted.'

    else 'Safe to paste and run the FULL migration file in one SQL Editor execution on Development only.'
  end as recommended_action_detail,

  case
    when od.branches_with_multiple_owners > 0
      then rs.duplicate_owners_to_demote
    else 0
  end as expected_duplicate_owner_demotions,

  case
    when bmo.branches_with_members_but_no_owner > 0
      then rsm.members_promoted_to_owner
    else 0
  end as expected_missing_owner_promotions,

  ih.pending_owner_invitations as expected_owner_invitation_revocations

from prerequisite p
cross join migration_state ms
cross join branch_counts bc
cross join membership_health mh
cross join owner_distribution od
cross join branches_missing_owner bmo
cross join repair_simulation rs
cross join repair_simulation_missing rsm
cross join invitation_health ih
cross join post_repair_owner_counts prc
cross join orphan_branch_risk obr;

-- Optional detail query (run separately): per-branch owner counts before migration
-- select
--   b.id as branch_id,
--   b.name,
--   count(*) filter (where bm.role = 'branch_admin') as owners,
--   count(*) filter (where bm.role = 'agent') as staff,
--   count(*) as members
-- from public.ea_branches b
-- left join public.ea_branch_members bm on bm.branch_id = b.id
-- group by b.id, b.name
-- order by owners desc, members desc;
