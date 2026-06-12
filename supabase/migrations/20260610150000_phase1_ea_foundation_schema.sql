-- Phase 1 PR1: Estate Agent foundation schema
--
-- Adds profiles.account_type (keeps legacy profiles.role unchanged),
-- estate agent organisation tables, RLS, and membership helpers.
--
-- Out of scope: assignments, delegated updates, billing, UI.

-- ---------------------------------------------------------------------------
-- profiles extensions
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists account_type text;

alter table public.profiles
  add column if not exists contact_name text;

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

alter table public.profiles
  add column if not exists email_domain text;

update public.profiles
set account_type = 'homeowner'
where account_type is null;

alter table public.profiles
  alter column account_type set default 'homeowner';

alter table public.profiles
  alter column account_type set not null;

alter table public.profiles
  drop constraint if exists profiles_account_type_check;

alter table public.profiles
  add constraint profiles_account_type_check
  check (
    account_type in (
      'homeowner',
      'estate_agent',
      'solicitor'
    )
  );

create index if not exists profiles_account_type_idx
  on public.profiles (account_type);

create index if not exists profiles_email_domain_idx
  on public.profiles (email_domain)
  where email_domain is not null;

comment on column public.profiles.account_type is
  'Platform account experience: homeowner, estate_agent, or solicitor (future). Legacy profiles.role remains until deprecation.';

comment on column public.profiles.contact_name is
  'Display name for estate agent (and future professional) accounts.';

comment on column public.profiles.onboarding_completed_at is
  'When set, estate agent onboarding (company + first branch) is complete.';

comment on column public.profiles.email_domain is
  'Normalised registrable domain from the auth email; used for business email validation and company domain matching.';

-- ---------------------------------------------------------------------------
-- ea_companies
-- ---------------------------------------------------------------------------

create table if not exists public.ea_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email_domain text not null,
  created_by_user_id uuid not null references auth.users (id),
  stripe_customer_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ea_companies_name_not_empty_check
    check (char_length(trim(name)) >= 2),

  constraint ea_companies_email_domain_not_empty_check
    check (char_length(trim(email_domain)) >= 3)
);

create unique index if not exists ea_companies_email_domain_unique_idx
  on public.ea_companies (lower(email_domain));

create index if not exists ea_companies_created_by_user_id_idx
  on public.ea_companies (created_by_user_id);

comment on table public.ea_companies is
  'Estate agency company (billing entity). One company has many branches.';

comment on column public.ea_companies.stripe_customer_id is
  'Reserved for Phase 2 billing; NULL in foundation phase.';

-- ---------------------------------------------------------------------------
-- ea_branches
-- ---------------------------------------------------------------------------

create table if not exists public.ea_branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ea_companies (id) on delete cascade,
  name text not null,
  town_or_city text not null,
  postcode text not null,
  region_code text not null,
  is_head_office boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ea_branches_name_not_empty_check
    check (char_length(trim(name)) >= 2),

  constraint ea_branches_town_or_city_not_empty_check
    check (char_length(trim(town_or_city)) >= 2),

  constraint ea_branches_postcode_not_empty_check
    check (char_length(trim(postcode)) >= 2),

  constraint ea_branches_region_code_not_empty_check
    check (char_length(trim(region_code)) >= 2)
);

create index if not exists ea_branches_company_id_idx
  on public.ea_branches (company_id);

create index if not exists ea_branches_region_code_idx
  on public.ea_branches (region_code);

create unique index if not exists ea_branches_one_head_office_per_company_idx
  on public.ea_branches (company_id)
  where is_head_office = true;

comment on table public.ea_branches is
  'Estate agency branch (operational and future benchmarking unit).';

comment on column public.ea_branches.town_or_city is
  'Primary location label agents use to identify the branch (e.g. Fareham, Portsmouth).';

comment on column public.ea_branches.region_code is
  'Benchmarking region identifier (e.g. UK-SOUTH-EAST).';

-- ---------------------------------------------------------------------------
-- ea_branch_members
-- ---------------------------------------------------------------------------

create table if not exists public.ea_branch_members (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.ea_branches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),

  constraint ea_branch_members_role_check
    check (role in ('branch_admin', 'agent')),

  constraint ea_branch_members_branch_user_unique
    unique (branch_id, user_id)
);

create index if not exists ea_branch_members_user_id_idx
  on public.ea_branch_members (user_id);

create index if not exists ea_branch_members_branch_id_idx
  on public.ea_branch_members (branch_id);

comment on table public.ea_branch_members is
  'Links estate agent users to branches. Founding onboarding user receives branch_admin.';

comment on column public.ea_branch_members.role is
  'branch_admin or agent. Future company-level admin lives in a separate table.';

-- ---------------------------------------------------------------------------
-- membership helper functions (RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_ea_branch_member(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = p_branch_id
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_branch_member(uuid) is
  'True when the current user belongs to the given estate agent branch.';

create or replace function public.is_ea_company_member(
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_members bm
    inner join public.ea_branches b
      on b.id = bm.branch_id
    where b.company_id = p_company_id
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_company_member(uuid) is
  'True when the current user belongs to any branch under the given company.';

create or replace function public.is_ea_branch_admin(
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = p_branch_id
      and bm.user_id = auth.uid()
      and bm.role = 'branch_admin'
  );
$$;

comment on function public.is_ea_branch_admin(uuid) is
  'True when the current user is a branch_admin of the given branch.';

revoke all on function public.is_ea_branch_member(uuid) from public;
revoke all on function public.is_ea_company_member(uuid) from public;
revoke all on function public.is_ea_branch_admin(uuid) from public;

grant execute on function public.is_ea_branch_member(uuid) to authenticated;
grant execute on function public.is_ea_company_member(uuid) to authenticated;
grant execute on function public.is_ea_branch_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: ea_companies
-- ---------------------------------------------------------------------------

alter table public.ea_companies enable row level security;

drop policy if exists ea_companies_select_members
  on public.ea_companies;

-- Members of any branch under the company may read the company record.
create policy ea_companies_select_members
  on public.ea_companies
  for select
  to authenticated
  using (
    public.is_ea_company_member(id)
  );

drop policy if exists ea_companies_insert_founding
  on public.ea_companies;

-- Founding estate agent creates their company during onboarding.
create policy ea_companies_insert_founding
  on public.ea_companies
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.account_type = 'estate_agent'
    )
    and lower(email_domain) = lower(
      coalesce(
        (
          select p.email_domain
          from public.profiles p
          where p.id = auth.uid()
        ),
        split_part(
          (
            select u.email
            from auth.users u
            where u.id = auth.uid()
          ),
          '@',
          2
        )
      )
    )
  );

drop policy if exists ea_companies_update_admins
  on public.ea_companies;

-- Company creator or any branch_admin in the company may update company details.
create policy ea_companies_update_admins
  on public.ea_companies
  for update
  to authenticated
  using (
    created_by_user_id = auth.uid()
    or exists (
      select 1
      from public.ea_branch_members bm
      inner join public.ea_branches b
        on b.id = bm.branch_id
      where b.company_id = ea_companies.id
        and bm.user_id = auth.uid()
        and bm.role = 'branch_admin'
    )
  )
  with check (
    created_by_user_id = auth.uid()
    or exists (
      select 1
      from public.ea_branch_members bm
      inner join public.ea_branches b
        on b.id = bm.branch_id
      where b.company_id = ea_companies.id
        and bm.user_id = auth.uid()
        and bm.role = 'branch_admin'
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: ea_branches
-- ---------------------------------------------------------------------------

alter table public.ea_branches enable row level security;

drop policy if exists ea_branches_select_members
  on public.ea_branches;

-- Branch members and fellow company branch members may read branch records.
create policy ea_branches_select_members
  on public.ea_branches
  for select
  to authenticated
  using (
    public.is_ea_company_member(company_id)
  );

drop policy if exists ea_branches_insert_founding
  on public.ea_branches;

-- Founding user inserts the first branch(es) for their company during onboarding.
create policy ea_branches_insert_founding
  on public.ea_branches
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ea_companies c
      where c.id = company_id
        and c.created_by_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.account_type = 'estate_agent'
    )
  );

drop policy if exists ea_branches_update_admins
  on public.ea_branches;

-- Branch admins may update their branch; company creator may update during onboarding.
create policy ea_branches_update_admins
  on public.ea_branches
  for update
  to authenticated
  using (
    public.is_ea_branch_admin(id)
    or exists (
      select 1
      from public.ea_companies c
      where c.id = ea_branches.company_id
        and c.created_by_user_id = auth.uid()
    )
  )
  with check (
    public.is_ea_branch_admin(id)
    or exists (
      select 1
      from public.ea_companies c
      where c.id = ea_branches.company_id
        and c.created_by_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: ea_branch_members
-- ---------------------------------------------------------------------------

alter table public.ea_branch_members enable row level security;

drop policy if exists ea_branch_members_select_scope
  on public.ea_branch_members;

-- Users see their own memberships; branch admins see all members in their branch.
create policy ea_branch_members_select_scope
  on public.ea_branch_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_ea_branch_admin(branch_id)
  );

drop policy if exists ea_branch_members_insert_founding
  on public.ea_branch_members;

-- Founding user inserts themselves as branch_admin during onboarding.
create policy ea_branch_members_insert_founding
  on public.ea_branch_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'branch_admin'
    and exists (
      select 1
      from public.ea_branches b
      inner join public.ea_companies c
        on c.id = b.company_id
      where b.id = branch_id
        and c.created_by_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.account_type = 'estate_agent'
    )
  );

drop policy if exists ea_branch_members_update_admins
  on public.ea_branch_members;

-- Branch admins may update member roles within their branch (future invites).
create policy ea_branch_members_update_admins
  on public.ea_branch_members
  for update
  to authenticated
  using (
    public.is_ea_branch_admin(branch_id)
  )
  with check (
    public.is_ea_branch_admin(branch_id)
  );

-- ---------------------------------------------------------------------------
-- grants (RLS restricts row access; no anon access)
-- ---------------------------------------------------------------------------

revoke all on public.ea_companies from public;
revoke all on public.ea_branches from public;
revoke all on public.ea_branch_members from public;

revoke all on public.ea_companies from anon;
revoke all on public.ea_branches from anon;
revoke all on public.ea_branch_members from anon;

grant select, insert, update on public.ea_companies to authenticated;
grant select, insert, update on public.ea_branches to authenticated;
grant select, insert, update on public.ea_branch_members to authenticated;
