-- Phase 1: Property operational identity foundation
--
-- Introduces first-class operational homeowner identity, delegates, counterparty
-- participants, and de-link audit. Does NOT yet revoke ensure_property_membership
-- or enforce grants — see docs/PROPERTY_OWNERSHIP_MODEL.md Phase 2.

-- ---------------------------------------------------------------------------
-- property_operational_identities
-- ---------------------------------------------------------------------------

create table if not exists public.property_operational_identities (
  property_id bigint primary key
    references public.properties (id) on delete cascade,
  homeowner_user_id uuid not null references auth.users (id),
  operational_role text not null,
  granted_via text not null,
  status text not null default 'active',
  granted_at timestamptz not null default now(),
  delinked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_operational_identities_role_check
    check (operational_role in ('seller', 'buyer')),

  constraint property_operational_identities_status_check
    check (status in ('active', 'delinked', 'released')),

  constraint property_operational_identities_granted_via_check
    check (
      granted_via in (
        'start_move',
        'claim_operational_property',
        'ea_origination_claim',
        'convert_placeholder',
        'backfill'
      )
    )
);

create unique index if not exists property_operational_identities_one_active_per_property
  on public.property_operational_identities (property_id)
  where status = 'active';

create index if not exists property_operational_identities_homeowner_user_id_idx
  on public.property_operational_identities (homeowner_user_id)
  where status = 'active';

comment on table public.property_operational_identities is
  'Single operational homeowner identity per live property. Supersedes generic property_members for ownership authority.';

-- ---------------------------------------------------------------------------
-- property_counterparty_participants
-- ---------------------------------------------------------------------------

create table if not exists public.property_counterparty_participants (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  counterparty_role text not null,
  granted_via text not null default 'join_chain_property',
  status text not null default 'active',
  granted_at timestamptz not null default now(),
  delinked_at timestamptz null,
  created_at timestamptz not null default now(),

  constraint property_counterparty_participants_role_check
    check (counterparty_role in ('buyer', 'seller')),

  constraint property_counterparty_participants_status_check
    check (status in ('active', 'delinked')),

  constraint property_counterparty_participants_one_user_per_property
    unique (property_id, user_id)
);

create index if not exists property_counterparty_participants_property_id_idx
  on public.property_counterparty_participants (property_id)
  where status = 'active';

comment on table public.property_counterparty_participants is
  'Chain counterparty on a property hop. Not an operational homeowner identity.';

-- ---------------------------------------------------------------------------
-- property_delegates
-- ---------------------------------------------------------------------------

create table if not exists public.property_delegates (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  delegate_user_id uuid not null references auth.users (id),
  invited_by_user_id uuid not null references auth.users (id),
  permissions text[] not null default array['view']::text[],
  status text not null default 'pending',
  invited_at timestamptz not null default now(),
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_delegates_status_check
    check (status in ('pending', 'active', 'revoked')),

  constraint property_delegates_one_per_user_per_property
    unique (property_id, delegate_user_id)
);

create index if not exists property_delegates_property_id_idx
  on public.property_delegates (property_id)
  where status = 'active';

comment on table public.property_delegates is
  'Household delegates invited by the operational homeowner. Not independent owners.';

-- ---------------------------------------------------------------------------
-- property_delink_events
-- ---------------------------------------------------------------------------

create table if not exists public.property_delink_events (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  chain_id bigint null references public.chains (id) on delete set null,
  actor_user_id uuid not null references auth.users (id),
  actor_type text not null,
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint property_delink_events_actor_type_check
    check (actor_type in ('homeowner', 'estate_agent', 'system'))
);

create index if not exists property_delink_events_property_id_idx
  on public.property_delink_events (property_id, created_at desc);

comment on table public.property_delink_events is
  'Append-only audit trail for homeowner and estate agent de-link operations.';

-- ---------------------------------------------------------------------------
-- RLS: service/workflow access only (Phase 2 opens participant read paths)
-- ---------------------------------------------------------------------------

alter table public.property_operational_identities enable row level security;
alter table public.property_counterparty_participants enable row level security;
alter table public.property_delegates enable row level security;
alter table public.property_delink_events enable row level security;

revoke all on public.property_operational_identities from public;
revoke all on public.property_counterparty_participants from public;
revoke all on public.property_delegates from public;
revoke all on public.property_delink_events from public;

-- Authenticated users may read their own identity rows (Phase 1 minimal SELECT).

create policy property_operational_identities_select_own
  on public.property_operational_identities
  for select
  to authenticated
  using (homeowner_user_id = auth.uid());

create policy property_counterparty_participants_select_own
  on public.property_counterparty_participants
  for select
  to authenticated
  using (user_id = auth.uid());

create policy property_delegates_select_involved
  on public.property_delegates
  for select
  to authenticated
  using (
    delegate_user_id = auth.uid()
    or invited_by_user_id = auth.uid()
  );

grant select on public.property_operational_identities to authenticated;
grant select on public.property_counterparty_participants to authenticated;
grant select on public.property_delegates to authenticated;

-- ---------------------------------------------------------------------------
-- Anomaly report: properties with multiple owner-class members
-- ---------------------------------------------------------------------------

create or replace function public.report_multiple_operational_homeowners()
returns table (
  property_id bigint,
  relationship_type text,
  owner_role text,
  user_count bigint,
  user_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as property_id,
    p.relationship_type,
    case
      when p.relationship_type = 'sale' then 'seller'
      when p.relationship_type = 'purchase' then 'buyer'
      else null
    end as owner_role,
    count(distinct pm.user_id) as user_count,
    array_agg(distinct pm.user_id order by pm.user_id) as user_ids
  from public.properties p
  inner join public.property_members pm
    on pm.property_id = p.id
  where p.relationship_type in ('sale', 'purchase')
    and pm.role = case
      when p.relationship_type = 'sale' then 'seller'
      when p.relationship_type = 'purchase' then 'buyer'
    end
  group by p.id, p.relationship_type
  having count(distinct pm.user_id) > 1;
$$;

comment on function public.report_multiple_operational_homeowners() is
  'Pre-launch audit: surfaces properties violating single operational homeowner identity.';

revoke all on function public.report_multiple_operational_homeowners() from public;
grant execute on function public.report_multiple_operational_homeowners() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill operational identities from earliest owner-class member (report-only conflicts)
-- ---------------------------------------------------------------------------

insert into public.property_operational_identities (
  property_id,
  homeowner_user_id,
  operational_role,
  granted_via,
  status,
  granted_at
)
select
  p.id,
  owner_member.user_id,
  case
    when p.relationship_type = 'sale' then 'seller'
    else 'buyer'
  end,
  'backfill',
  'active',
  coalesce(owner_member.created_at, now())
from public.properties p
inner join lateral (
  select pm.user_id, pm.created_at
  from public.property_members pm
  where pm.property_id = p.id
    and pm.role = case
      when p.relationship_type = 'sale' then 'seller'
      when p.relationship_type = 'purchase' then 'buyer'
    end
  order by pm.created_at asc nulls last, pm.user_id
  limit 1
) owner_member on true
where p.relationship_type in ('sale', 'purchase')
  and not exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p.id
  )
on conflict (property_id) do nothing;

-- Counterparty backfill from non-owner roles on sale/purchase rows.

insert into public.property_counterparty_participants (
  property_id,
  user_id,
  counterparty_role,
  granted_via,
  status,
  granted_at
)
select
  p.id,
  pm.user_id,
  pm.role,
  'join_chain_property',
  'active',
  coalesce(pm.created_at, now())
from public.properties p
inner join public.property_members pm
  on pm.property_id = p.id
where p.relationship_type = 'sale'
  and pm.role = 'buyer'
  and not exists (
    select 1
    from public.property_counterparty_participants pcp
    where pcp.property_id = p.id
      and pcp.user_id = pm.user_id
  )
union all
select
  p.id,
  pm.user_id,
  pm.role,
  'join_chain_property',
  'active',
  coalesce(pm.created_at, now())
from public.properties p
inner join public.property_members pm
  on pm.property_id = p.id
where p.relationship_type = 'purchase'
  and pm.role = 'seller'
  and not exists (
    select 1
    from public.property_counterparty_participants pcp
    where pcp.property_id = p.id
      and pcp.user_id = pm.user_id
  );
