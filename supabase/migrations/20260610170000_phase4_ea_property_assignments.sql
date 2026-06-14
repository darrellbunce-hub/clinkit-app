-- Phase 4 PR4: Estate agent property assignments & dashboard summaries
--
-- Property-scoped branch assignments with delegation metadata.
-- Summary views for agent dashboard (no activity scans on list load).

-- ---------------------------------------------------------------------------
-- property_ea_assignments
-- ---------------------------------------------------------------------------

create table if not exists public.property_ea_assignments (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  branch_id uuid not null references public.ea_branches (id) on delete restrict,
  status text not null default 'active',
  homeowner_only_updates boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by_user_id uuid not null references auth.users (id),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_ea_assignments_status_check
    check (
      status in (
        'pending',
        'active',
        'declined',
        'revoked'
      )
    )
);

create unique index if not exists property_ea_assignments_one_active_per_property_idx
  on public.property_ea_assignments (property_id)
  where status = 'active';

create index if not exists property_ea_assignments_branch_id_idx
  on public.property_ea_assignments (branch_id);

create index if not exists property_ea_assignments_property_id_idx
  on public.property_ea_assignments (property_id);

create index if not exists property_ea_assignments_status_idx
  on public.property_ea_assignments (status);

comment on table public.property_ea_assignments is
  'Links a property to an estate agent branch. One active assignment per property.';

comment on column public.property_ea_assignments.homeowner_only_updates is
  'When true, assigned agents may view but not post delegated updates.';

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_property_member(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
      and pm.user_id = auth.uid()
  );
$$;

comment on function public.is_property_member(bigint) is
  'True when the current user is a member of the given property.';

create or replace function public.is_ea_assigned_to_property(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_assigned_to_property(bigint) is
  'True when the current user belongs to the branch actively assigned to the property.';

revoke all on function public.is_property_member(bigint) from public;
revoke all on function public.is_ea_assigned_to_property(bigint) from public;

grant execute on function public.is_property_member(bigint) to authenticated;
grant execute on function public.is_ea_assigned_to_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: property_ea_assignments
-- ---------------------------------------------------------------------------

alter table public.property_ea_assignments enable row level security;

drop policy if exists property_ea_assignments_select_scope
  on public.property_ea_assignments;

create policy property_ea_assignments_select_scope
  on public.property_ea_assignments
  for select
  to authenticated
  using (
    public.is_property_member(property_id)
    or exists (
      select 1
      from public.ea_branch_members bm
      where bm.branch_id = property_ea_assignments.branch_id
        and bm.user_id = auth.uid()
    )
  );

drop policy if exists property_ea_assignments_insert_homeowner
  on public.property_ea_assignments;

create policy property_ea_assignments_insert_homeowner
  on public.property_ea_assignments
  for insert
  to authenticated
  with check (
    assigned_by_user_id = auth.uid()
    and public.is_property_member(property_id)
    and status = 'active'
  );

drop policy if exists property_ea_assignments_update_homeowner
  on public.property_ea_assignments;

create policy property_ea_assignments_update_homeowner
  on public.property_ea_assignments
  for update
  to authenticated
  using (
    public.is_property_member(property_id)
  )
  with check (
    public.is_property_member(property_id)
  );

revoke all on public.property_ea_assignments from public;
revoke all on public.property_ea_assignments from anon;

grant select, insert, update on public.property_ea_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- ea_branch_directory: searchable branch list for homeowner assignment UI
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
  on c.id = b.company_id;

comment on view public.ea_branch_directory is
  'Public directory of registered estate agent branches for homeowner assignment search.';

revoke all on public.ea_branch_directory from public;
revoke all on public.ea_branch_directory from anon;

grant select on public.ea_branch_directory to authenticated;

-- ---------------------------------------------------------------------------
-- agent_branch_property_summaries: dashboard list (summary only, no activities)
-- ---------------------------------------------------------------------------

create or replace view public.agent_branch_property_summaries
with (security_invoker = false)
as
select
  pea.id as assignment_id,
  pea.property_id,
  pea.branch_id,
  pea.status as assignment_status,
  pea.homeowner_only_updates,
  pea.assigned_at,
  p.chain_id,
  p.address,
  p.postcode,
  p.stage,
  p.status as property_status,
  ch.completion_lifecycle_status,
  ch.completion_scheduled_date,
  ch.completed_at
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
where
  auth.uid() is not null
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  )
  and pea.status in ('active', 'revoked');

comment on view public.agent_branch_property_summaries is
  'Branch-scoped property assignment summaries for the estate agent dashboard.';

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;

grant select on public.agent_branch_property_summaries to authenticated;
