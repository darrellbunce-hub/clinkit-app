-- Fix: restore EA assignment-scoped chains SELECT (Phase 4A intent).
--
-- Production currently has chains_select_participants limited to property_members
-- only, even though migration 20260610280000 is recorded and helpers
-- is_ea_assigned_to_chain / is_chain_operational_viewer exist and return true
-- for assigned EAs. chain_nodes already uses is_chain_operational_viewer.
--
-- Symptom: EA-originated unclaimed sale (no property_members) is invisible on
-- public.chains to the originating assigned EA, so
-- loadOperationalRefreshDataset fails with "Chain not found or not visible."
--
-- This migration only replaces the chains SELECT policy. UPDATE remains
-- participant-only. No widening beyond existing operational-viewer helpers.

drop policy if exists chains_select_participants
  on public.chains;

create policy chains_select_participants
  on public.chains
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(id)
  );

comment on policy chains_select_participants on public.chains is
  'Chain participants or branch-assigned estate agents (via is_chain_operational_viewer) may select the chain row.';
