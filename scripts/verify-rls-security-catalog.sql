-- RLS security catalog verification (READ-ONLY)
-- Run in Supabase SQL Editor after applying
-- 20260829210000_rls_legacy_permissive_and_anon_hardening.sql
--
-- Expect: critical checks show fail_count = 0.
-- Review advisory rows for business decisions.

with public_tables as (
  select c.relname as table_name,
         c.relrowsecurity as rls_enabled,
         c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
),
policy_flags as (
  select
    p.tablename as table_name,
    p.policyname,
    p.cmd,
    p.roles::text as roles,
    p.qual,
    p.with_check,
    (
      'public' = any (p.roles)
      or p.roles::text ilike '%public%'
    ) as targets_public_role,
    (
      coalesce(p.qual, '') in ('true', '(true)')
      or coalesce(p.with_check, '') in ('true', '(true)')
    ) as uses_true,
    (
      p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        'anon' = any (p.roles)
        or 'public' = any (p.roles)
        or p.roles::text ilike '%anon%'
        or p.roles::text ilike '%public%'
      )
    ) as anon_or_public_mutation
  from pg_policies p
  where p.schemaname = 'public'
),
checks as (
  select
    'CRITICAL' as severity,
    'legacy_permissive_policy_name' as check_id,
    format('%s.%s', table_name, policyname) as detail
  from policy_flags
  where policyname in (
    'Enable read access for all users',
    'Allow property inserts',
    'Allow property updates',
    'Allow updates',
    'Allow property member reads',
    'Allow property member inserts',
    'Allow activity reads',
    'Allow activity inserts',
    'Allow chain reads',
    'Allow chain inserts',
    'Authenticated users can view their chain nodes',
    'Authenticated users can insert chain nodes',
    'Allow authenticated users to update own chain nodes'
  )

  union all

  select
    'CRITICAL',
    'policy_using_or_check_true',
    format('%s.%s cmd=%s', table_name, policyname, cmd)
  from policy_flags
  where uses_true

  union all

  select
    'CRITICAL',
    'anon_or_public_mutation_policy',
    format('%s.%s cmd=%s roles=%s', table_name, policyname, cmd, roles)
  from policy_flags
  where anon_or_public_mutation

  union all

  select
    'HIGH',
    'rls_disabled_on_sensitive_table',
    table_name
  from public_tables
  where not rls_enabled
    and table_name in (
      'profiles',
      'properties',
      'property_members',
      'chains',
      'chain_nodes',
      'activities',
      'operational_delays',
      'ea_companies',
      'ea_branches',
      'ea_branch_members',
      'billing_customer_email_dispatches',
      'email_events',
      'property_lifecycle_still_active_confirmations'
    )

  union all

  select
    'ADVISORY',
    'policy_targets_public_role',
    format('%s.%s cmd=%s', table_name, policyname, cmd)
  from policy_flags
  where targets_public_role
    and not uses_true
    and not anon_or_public_mutation

  union all

  select
    'ADVISORY',
    'rls_enabled_zero_policies',
    t.table_name
  from public_tables t
  where t.rls_enabled
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.table_name
    )
)
select
  severity,
  check_id,
  count(*) as fail_count,
  string_agg(detail, ' | ' order by detail) as details
from checks
group by severity, check_id
order by
  case severity
    when 'CRITICAL' then 1
    when 'HIGH' then 2
    else 3
  end,
  check_id;
