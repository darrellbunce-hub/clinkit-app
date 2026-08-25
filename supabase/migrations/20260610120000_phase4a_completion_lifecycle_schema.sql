-- Phase 4a: Completion lifecycle schema & workflow gates
--
-- Adds chain-level completion lifecycle columns, append-only completion events,
-- and database enforcement for the Contracts Exchanged → Completion Date Agreed gate.

-- ---------------------------------------------------------------------------
-- chains: completion lifecycle columns
-- ---------------------------------------------------------------------------

alter table public.chains
  add column if not exists completion_lifecycle_status text null;

alter table public.chains
  add column if not exists completion_scheduled_date date null;

alter table public.chains
  add column if not exists completion_date_recorded_at timestamptz null;

alter table public.chains
  add column if not exists completion_date_recorded_by_user_id uuid null
    references auth.users (id);

alter table public.chains
  add column if not exists completion_date_updated_at timestamptz null;

alter table public.chains
  add column if not exists completion_date_updated_by_user_id uuid null
    references auth.users (id);

alter table public.chains
  add column if not exists completion_confirmed_at timestamptz null;

alter table public.chains
  add column if not exists completion_confirmed_by_user_id uuid null
    references auth.users (id);

alter table public.chains
  add column if not exists completion_confirmed_by_role text null;

alter table public.chains
  add column if not exists completed_at timestamptz null;

alter table public.chains
  drop constraint if exists chains_completion_lifecycle_status_check;

alter table public.chains
  add constraint chains_completion_lifecycle_status_check
  check (
    completion_lifecycle_status is null
    or completion_lifecycle_status in (
      'scheduled',
      'awaiting_confirmation',
      'completed'
    )
  );

alter table public.chains
  drop constraint if exists chains_completion_confirmed_by_role_check;

alter table public.chains
  add constraint chains_completion_confirmed_by_role_check
  check (
    completion_confirmed_by_role is null
    or completion_confirmed_by_role in (
      'estate_agent',
      'participant'
    )
  );

alter table public.chains
  drop constraint if exists chains_completion_scheduled_date_requires_lifecycle_check;

alter table public.chains
  add constraint chains_completion_scheduled_date_requires_lifecycle_check
  check (
    completion_scheduled_date is null
    or completion_lifecycle_status is not null
  );

alter table public.chains
  drop constraint if exists chains_completion_recorded_metadata_check;

alter table public.chains
  add constraint chains_completion_recorded_metadata_check
  check (
    (
      completion_scheduled_date is null
      and completion_date_recorded_at is null
      and completion_date_recorded_by_user_id is null
    )
    or (
      completion_scheduled_date is not null
      and completion_date_recorded_at is not null
      and completion_date_recorded_by_user_id is not null
    )
  );

create index if not exists chains_completion_lifecycle_status_idx
  on public.chains (completion_lifecycle_status)
  where completion_lifecycle_status is not null;

create index if not exists chains_completion_scheduled_date_idx
  on public.chains (completion_scheduled_date)
  where completion_scheduled_date is not null;

comment on column public.chains.completion_lifecycle_status is
  'Completion lifecycle overlay: scheduled, awaiting_confirmation, or completed.';

comment on column public.chains.completion_scheduled_date is
  'Single active agreed completion date for the chain (not a target or estimate).';

-- ---------------------------------------------------------------------------
-- chain_completion_events: append-only audit / history
-- ---------------------------------------------------------------------------

create table if not exists public.chain_completion_events (
  id bigserial primary key,
  chain_id bigint not null references public.chains (id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid null references auth.users (id),
  actor_role text null,
  scheduled_date date null,
  previous_scheduled_date date null,
  payload jsonb null,
  constraint chain_completion_events_event_type_check
    check (
      event_type in (
        'completion_date_recorded',
        'completion_date_changed',
        'completion_date_update_acknowledged',
        'completion_confirmed',
        'completion_lifecycle_reset'
      )
    )
);

create index if not exists chain_completion_events_chain_id_occurred_at_idx
  on public.chain_completion_events (chain_id, occurred_at desc);

create index if not exists chain_completion_events_event_type_idx
  on public.chain_completion_events (event_type);

comment on table public.chain_completion_events is
  'Append-only completion lifecycle history for a chain (date changes, confirmation, resets).';

alter table public.chain_completion_events enable row level security;

drop policy if exists chain_completion_events_select_participants
  on public.chain_completion_events;

create policy chain_completion_events_select_participants
  on public.chain_completion_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chain_completion_events.chain_id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists chain_completion_events_insert_participants
  on public.chain_completion_events;

create policy chain_completion_events_insert_participants
  on public.chain_completion_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chain_completion_events.chain_id
        and pm.user_id = auth.uid()
    )
  );

revoke all on public.chain_completion_events from public;
revoke all on public.chain_completion_events from anon;
grant select, insert on public.chain_completion_events to authenticated;
grant usage, select on sequence public.chain_completion_events_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Workflow gate: Contracts Exchanged before Completion Date Agreed
-- ---------------------------------------------------------------------------

create or replace function public.validate_property_completion_stage_gate()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    return new;
  end if;

  if new.stage = 'completion_date_agreed' then
    if old.stage is distinct from 'contracts_exchanged' then
      raise exception
        using
          errcode = 'P0001',
          message = 'completion_date_agreed_requires_contracts_exchanged';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists properties_completion_stage_gate
  on public.properties;

create trigger properties_completion_stage_gate
  before update of stage
  on public.properties
  for each row
  execute function public.validate_property_completion_stage_gate();

create or replace function public.validate_chain_node_completion_stage_gate()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    return new;
  end if;

  if new.stage = 'completion_date_agreed' then
    if old.stage is distinct from 'exchange_contracts' then
      raise exception
        using
          errcode = 'P0001',
          message = 'completion_date_agreed_requires_contracts_exchanged';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists chain_nodes_completion_stage_gate
  on public.chain_nodes;

create trigger chain_nodes_completion_stage_gate
  before update of stage
  on public.chain_nodes
  for each row
  execute function public.validate_chain_node_completion_stage_gate();
