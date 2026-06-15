-- Drop legacy permissive RLS policies that predate PR5 and override participant-scoped policies.
--
-- Background (Development audit 2026-06-06):
--   PR5 policies from 20260610200000 / 20260610220000 were applied, but Dashboard-era
--   permissive SELECT policies remained attached. PostgreSQL OR-combines permissive
--   policies, so legacy USING (true) (or equivalent) nullified PR5 restrictions and
--   caused verify-participant-privacy-rls.mjs to fail:
--     "Account A cannot read peer property via base table"
--
-- Legacy policies removed (NOT defined in repo migrations — created via Supabase Dashboard
-- or pre-migration manual setup):
--   properties       → "Enable read access for all users"
--   property_members → "Allow property member reads"
--   activities       → "Allow activity reads"
--   chains           → "Allow chain reads"
--
-- PR5 policies retained (authoritative after this migration):
--   properties       → properties_select_member_or_agent, properties_insert_creator,
--                      properties_update_member
--   property_members → property_members_select_own, property_members_insert_own
--   activities       → activities_select_chain_participant, activities_insert_participant
--   chains           → chains_select_participants, chains_update_participants,
--                      chains_insert_authenticated
--
-- Prerequisite: 20260610220000_reconcile_phase5_homeowner_privacy_rls.sql
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS).
--
-- Verify after apply:
--   node scripts/verify-participant-privacy-rls.mjs  (expect 11/11 after 20260610226000)

-- ---------------------------------------------------------------------------
-- Step 1: Log exact policy definitions from catalog (audit trail at apply time)
-- ---------------------------------------------------------------------------

do $$
declare
  v_policy record;
  v_expected constant text[] := array[
    'Enable read access for all users',
    'Allow property member reads',
    'Allow activity reads',
    'Allow chain reads'
  ];
  v_found bigint := 0;
begin
  for v_policy in
    select
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual as using_expression,
      with_check
    from pg_policies
    where schemaname = 'public'
      and policyname = any (v_expected)
    order by tablename, policyname
  loop
    v_found := v_found + 1;

    raise notice
      'legacy_rls_audit: %.% policy "%" cmd=% roles=% permissive=% using=% with_check=%',
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.policyname,
      v_policy.cmd,
      v_policy.roles,
      v_policy.permissive,
      coalesce(v_policy.using_expression, '<null>'),
      coalesce(v_policy.with_check, '<null>');
  end loop;

  if v_found = 0 then
    raise notice
      'legacy_rls_audit: no legacy policies found — drops below are no-ops';
  else
    raise notice
      'legacy_rls_audit: found % legacy polic(ies) to drop', v_found;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Drop legacy permissive SELECT policies only
-- ---------------------------------------------------------------------------

drop policy if exists "Enable read access for all users"
  on public.properties;

drop policy if exists "Allow property member reads"
  on public.property_members;

drop policy if exists "Allow activity reads"
  on public.activities;

drop policy if exists "Allow chain reads"
  on public.chains;

-- ---------------------------------------------------------------------------
-- Step 3: Post-drop verification (fail if legacy policies still exist)
-- ---------------------------------------------------------------------------

do $$
declare
  v_remaining bigint;
begin
  select count(*)
  into v_remaining
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'Enable read access for all users',
      'Allow property member reads',
      'Allow activity reads',
      'Allow chain reads'
    );

  if v_remaining > 0 then
    raise exception
      'legacy_rls_cleanup failed: % legacy polic(ies) still present',
      v_remaining;
  end if;

  raise notice 'legacy_rls_cleanup verified: all four legacy policies removed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback plan (manual — do not run unless intentionally restoring open access)
-- ---------------------------------------------------------------------------
-- Recreating legacy policies would re-open base-table reads for all authenticated
-- users and is NOT recommended. If rollback is required for emergency debugging
-- only, inspect migration logs for Step 1 NOTICE output (exact USING clauses) and
-- recreate matching policies manually. Prefer fixing forward via PR5 policies.
