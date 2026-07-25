-- Operational summary refresh: expose stage_entered_at on participant view.
-- Fixes PostgREST 42703 when loadOperationalRefreshDataset selects stage_entered_at.
--
-- Prerequisite: 20260720100000 (properties.stage_entered_at column)
--              20260610280000 (authoritative chain_properties_participant definition)
--
-- IMPORTANT: append stage_entered_at at the END of the view column list.
-- PostgreSQL CREATE OR REPLACE VIEW cannot insert a column mid-list (42P16).
-- Idempotent: safe to re-run on Development.

create or replace view public.chain_properties_participant
with (security_invoker = false)
as
select
  p.id,
  p.chain_id,
  p.chain_position,
  p.stage,
  p.status,
  p.relationship_type,
  p.linked_property_id,
  p.is_searching,
  p.buyer_connected,
  p.seller_connected,
  p.awaiting_buyer,
  p.created_by_user_id,
  case
    when public.is_property_member(p.id) then p.address
    when public.is_ea_assigned_to_property(p.id) then p.address
    else null
  end as address,
  case
    when public.is_property_member(p.id) then p.postcode
    when public.is_ea_assigned_to_property(p.id) then p.postcode
    else null
  end as postcode,
  public.current_user_property_role(p.id) as current_user_role,
  public.is_property_member(p.id) as is_own_property,
  exists (
    select 1
    from public.property_members pm2
    where pm2.property_id = p.id
  ) as has_members,
  p.stage_entered_at
from public.properties p
where
  auth.uid() is not null
  and public.is_chain_operational_viewer(p.chain_id);

comment on view public.chain_properties_participant is
  'Operational chain topology for members and assignment-scoped estate agents; address visible only for own or assigned properties; stage_entered_at exposed for chain intelligence timing.';

revoke all on public.chain_properties_participant from public;
revoke all on public.chain_properties_participant from anon;
grant select on public.chain_properties_participant to authenticated;
