-- Phase 1 PR3 fix: profiles self-service RLS
--
-- Problem: Estate Agent signup writes the caller's profiles row via upsert, but
-- staging had no INSERT/UPDATE policy (or only SELECT) on public.profiles.
-- Postgres reports: "new row violates row-level security policy for table profiles"
--
-- Scope: own-row SELECT / INSERT / UPDATE only. No cross-user access. No DELETE.

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own
  on public.profiles;

drop policy if exists profiles_insert_own
  on public.profiles;

drop policy if exists profiles_update_own
  on public.profiles;

-- Authenticated users may read their own profile only.
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Authenticated users may create their own profile row (signup).
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- Authenticated users may update their own profile row (onboarding completion, etc.).
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke all on public.profiles from anon;

grant select, insert, update on public.profiles to authenticated;

comment on policy profiles_select_own on public.profiles is
  'Caller may read only their own profile row (id = auth.uid()).';

comment on policy profiles_insert_own on public.profiles is
  'Caller may insert only a profile row whose primary key matches auth.uid().';

comment on policy profiles_update_own on public.profiles is
  'Caller may update only their own profile row; WITH CHECK prevents id reassignment.';
