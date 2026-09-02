-- Smoke-test fixture registry (Production-safe marker + directory isolation).
-- Non-destructive: adds registry tables, helper RPCs, and filters ea_branch_directory.
-- Does NOT delete data. Does NOT alter founding ledger behaviour.
-- Authenticated clients cannot write fixture markers.

-- ---------------------------------------------------------------------------
-- 1) Fixture registry
-- ---------------------------------------------------------------------------

create table if not exists public.smoke_test_fixtures (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  status text not null default 'active'
    check (status in ('active', 'cleaned')),
  notes text null,
  created_by_admin_user_id uuid null
    references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  cleaned_at timestamptz null,
  cleaned_by_admin_user_id uuid null
    references auth.users (id) on delete set null,
  constraint smoke_test_fixtures_label_not_empty_check
    check (char_length(trim(label)) >= 2)
);

comment on table public.smoke_test_fixtures is
  'Explicit Production smoke-test fixture registry. Markers are service-role / platform-admin only — never client-writable.';

create table if not exists public.smoke_test_fixture_objects (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null
    references public.smoke_test_fixtures (id) on delete cascade,
  object_type text not null
    check (
      object_type in (
        'auth_user',
        'profile',
        'ea_company',
        'ea_branch',
        'ea_branch_member',
        'ea_branch_invitation',
        'property',
        'chain',
        'property_member',
        'chain_node',
        'property_ea_assignment',
        'activity'
      )
    ),
  object_id text not null,
  ownership text not null
    check (ownership in ('owned', 'linked')),
  created_at timestamptz not null default now(),
  constraint smoke_test_fixture_objects_unique
    unique (fixture_id, object_type, object_id)
);

comment on table public.smoke_test_fixture_objects is
  'Objects belonging to a smoke fixture. ownership=owned may be deleted by cleanup; ownership=linked may only be delinked/revoked.';

comment on column public.smoke_test_fixture_objects.ownership is
  'owned = fixture created this record (safe to delete). linked = fixture touched a non-owned record (e.g. assignment to a real property); cleanup must not delete the parent.';

create index if not exists smoke_test_fixture_objects_type_id_idx
  on public.smoke_test_fixture_objects (object_type, object_id);

create index if not exists smoke_test_fixture_objects_fixture_id_idx
  on public.smoke_test_fixture_objects (fixture_id);

create table if not exists public.smoke_test_fixture_audit_events (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid null
    references public.smoke_test_fixtures (id) on delete set null,
  event_type text not null,
  actor_admin_user_id uuid null
    references auth.users (id) on delete set null,
  dry_run boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.smoke_test_fixture_audit_events is
  'Audit trail for smoke fixture create/register/cleanup. Service-role only.';

alter table public.smoke_test_fixtures enable row level security;
alter table public.smoke_test_fixture_objects enable row level security;
alter table public.smoke_test_fixture_audit_events enable row level security;

revoke all on public.smoke_test_fixtures from public, anon, authenticated;
revoke all on public.smoke_test_fixture_objects from public, anon, authenticated;
revoke all on public.smoke_test_fixture_audit_events from public, anon, authenticated;

grant select, insert, update, delete on public.smoke_test_fixtures to service_role;
grant select, insert, update, delete on public.smoke_test_fixture_objects to service_role;
grant select, insert, update, delete on public.smoke_test_fixture_audit_events to service_role;

-- ---------------------------------------------------------------------------
-- 2) Helpers — readable by authenticated for Checkout/directory guards only
-- ---------------------------------------------------------------------------

create or replace function public.is_smoke_test_ea_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.smoke_test_fixture_objects o
    inner join public.smoke_test_fixtures f
      on f.id = o.fixture_id
    where o.object_type = 'ea_branch'
      and o.object_id = p_branch_id::text
      and f.status = 'active'
  );
$$;

comment on function public.is_smoke_test_ea_branch(uuid) is
  'True when branch is registered on an active smoke-test fixture. Used to exclude from directory and block founding Checkout.';

revoke all on function public.is_smoke_test_ea_branch(uuid) from public, anon;
grant execute on function public.is_smoke_test_ea_branch(uuid) to authenticated;
grant execute on function public.is_smoke_test_ea_branch(uuid) to service_role;

create or replace function public.is_smoke_test_owned_object(
  p_object_type text,
  p_object_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.smoke_test_fixture_objects o
    inner join public.smoke_test_fixtures f
      on f.id = o.fixture_id
    where o.object_type = p_object_type
      and o.object_id = p_object_id
      and o.ownership = 'owned'
      and f.status = 'active'
  );
$$;

comment on function public.is_smoke_test_owned_object(text, text) is
  'True when object is fixture-owned (safe delete candidate). Service-role cleanup uses registry rows directly; this helper supports guards.';

revoke all on function public.is_smoke_test_owned_object(text, text) from public, anon, authenticated;
grant execute on function public.is_smoke_test_owned_object(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Homeowner EA directory — exclude active smoke-test branches
-- ---------------------------------------------------------------------------

create or replace view public.ea_branch_directory
with (security_invoker = false)
as
select
  b.id as branch_id,
  b.name as branch_name,
  b.town_or_city,
  b.postcode,
  c.id as company_id,
  c.name as company_name
from public.ea_branches b
inner join public.ea_companies c
  on c.id = b.company_id
where not exists (
  select 1
  from public.smoke_test_fixture_objects o
  inner join public.smoke_test_fixtures f
    on f.id = o.fixture_id
  where o.object_type = 'ea_branch'
    and o.object_id = b.id::text
    and f.status = 'active'
);

comment on view public.ea_branch_directory is
  'Authenticated homeowner EA assignment directory. Excludes branches registered on active smoke-test fixtures.';

revoke all on public.ea_branch_directory from public;
revoke all on public.ea_branch_directory from anon;
grant select on public.ea_branch_directory to authenticated;
