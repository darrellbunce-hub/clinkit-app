-- Phase 4b: allow chain participants to record agreed completion dates on chains

alter table public.chains enable row level security;

drop policy if exists chains_select_participants
  on public.chains;

create policy chains_select_participants
  on public.chains
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chains.id
        and pm.user_id = auth.uid()
    )
  );

drop policy if exists chains_update_participants
  on public.chains;

create policy chains_update_participants
  on public.chains
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chains.id
        and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.properties p
      inner join public.property_members pm
        on pm.property_id = p.id
      where p.chain_id = chains.id
        and pm.user_id = auth.uid()
    )
  );

grant select, update on public.chains to authenticated;
