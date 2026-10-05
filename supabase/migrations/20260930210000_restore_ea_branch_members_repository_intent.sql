-- Restore ea_branch_members RLS and grants to repository intent (forward-only).
--
-- Production drift: ea_branch_members carries the original 20260610150000
-- definitions even though 20260712210000 and 20260721100000 are recorded:
--   - ea_branch_members_update_admins (UPDATE for branch admins) still exists;
--   - authenticated still holds UPDATE on public.ea_branch_members;
--   - ea_branch_members_select_scope is (user_id = auth.uid() OR
--     is_ea_branch_admin(branch_id)) instead of the 20260712210000 expression.
--
-- Repository intent:
--   - 20260721100000 (OC-01): no direct role/membership mutation by
--     authenticated users. Membership and ownership changes go through the
--     SECURITY DEFINER RPCs (accept_ea_branch_invitation,
--     remove_ea_branch_member, transfer_ea_branch_ownership), which are
--     unaffected by this migration.
--   - 20260712210000: all members of a branch may read that branch's members,
--     via the SECURITY DEFINER helper get_auth_user_ea_branch_ids() to avoid
--     RLS recursion.
--
-- Unchanged: ea_branch_members_insert_founding, SELECT/INSERT/DELETE grants,
-- ea_branch_owner_invariant_trigger, RLS enablement, all functions, all data.
--
-- Development already matches this state (no-op there).
-- Idempotent: DROP POLICY IF EXISTS / REVOKE are safe to re-run.

-- ---------------------------------------------------------------------------
-- 0) Preflight — select helper must exist and be SECURITY DEFINER
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_auth_user_ea_branch_ids'
      and p.pronargs = 0
      and p.prosecdef
  ) then
    raise exception
      'restore_ea_branch_members aborted: public.get_auth_user_ea_branch_ids() missing or not SECURITY DEFINER (policy would recurse)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Remove direct UPDATE path for authenticated users
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_members_update_admins
  on public.ea_branch_members;

revoke update on public.ea_branch_members from authenticated;

-- ---------------------------------------------------------------------------
-- 2) SELECT scope — teammates visible without policy recursion
-- ---------------------------------------------------------------------------

drop policy if exists ea_branch_members_select_scope
  on public.ea_branch_members;

create policy ea_branch_members_select_scope
  on public.ea_branch_members
  for select
  to authenticated
  using (
    branch_id in (
      select public.get_auth_user_ea_branch_ids()
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Verify
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ea_branch_members'
      and cmd in ('UPDATE', 'ALL')
  ) then
    raise exception
      'restore_ea_branch_members failed: an UPDATE-capable policy remains on ea_branch_members';
  end if;

  if has_any_column_privilege('authenticated', 'public.ea_branch_members', 'UPDATE') then
    raise exception
      'restore_ea_branch_members failed: authenticated still has UPDATE (table or column level) on ea_branch_members';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ea_branch_members'
      and policyname = 'ea_branch_members_insert_founding'
      and cmd = 'INSERT'
  ) then
    raise exception
      'restore_ea_branch_members failed: ea_branch_members_insert_founding is missing';
  end if;
end;
$$;
