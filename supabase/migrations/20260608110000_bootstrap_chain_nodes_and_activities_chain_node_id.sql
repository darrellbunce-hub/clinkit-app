-- Production catalog-aware bootstrap (Phase 2D)
-- Prerequisite for: 20260608120000_phase2a_chain_nodes_chain_summary.sql
--
-- One-time Production catch-up. Fail loud if catalog is not the discovered baseline.
-- Not for Development replay.
--
-- Scope: empty public.chain_nodes + activities.chain_node_id FK.
-- Out of scope: RLS/policies/grants, comments, backfill, searching, PR5,
-- legacy policy drops, and any DML.

create table public.chain_nodes (
  id bigint generated always as identity not null,
  chain_id bigint not null,
  node_type text not null,
  linked_property_id bigint null,
  user_id uuid null,
  position integer not null,
  stage text null,
  status text null default 'healthy',
  progress integer null default 0,
  created_at timestamptz null default now(),
  stage_entered_at timestamptz null,
  constraint chain_nodes_pkey primary key (id)
);

alter table public.activities
  add column chain_node_id bigint null;

alter table public.activities
  add constraint activities_chain_node_id_fkey
  foreign key (chain_node_id)
  references public.chain_nodes (id);
