-- Fix PR5: chain_properties_participant current_user_role scalar subquery (21000)
--
-- Root cause: (SELECT pm.role FROM property_members ...) assumed at most one row
-- per (property_id, user_id). Users with duplicate membership rows (e.g. participant
-- + seller, or repeated join inserts) caused PostgreSQL error 21000 when the
-- dashboard loaded chain_properties_participant via ChainContext.

-- ---------------------------------------------------------------------------
-- Helper: deterministic single role when multiple membership rows exist
-- ---------------------------------------------------------------------------

create or replace function public.current_user_property_role(
  p_property_id bigint
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pm.role
  from public.property_members pm
  where pm.property_id = p_property_id
    and pm.user_id = auth.uid()
  order by
    case pm.role
      when 'seller' then 1
      when 'buyer' then 2
      else 3
    end,
    pm.created_at desc nulls last,
    pm.id
  limit 1;
$$;

comment on function public.current_user_property_role(bigint) is
  'Returns one membership role for the current user on a property; prefers seller/buyer over legacy roles.';

revoke all on function public.current_user_property_role(bigint) from public;
grant execute on function public.current_user_property_role(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Recreate participant view with multi-row-safe role lookup
-- ---------------------------------------------------------------------------

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
    else null
  end as address,
  case
    when public.is_property_member(p.id) then p.postcode
    else null
  end as postcode,
  public.current_user_property_role(p.id) as current_user_role,
  public.is_property_member(p.id) as is_own_property,
  exists (
    select 1
    from public.property_members pm2
    where pm2.property_id = p.id
  ) as has_members
from public.properties p
where
  auth.uid() is not null
  and public.is_chain_participant(p.chain_id);

comment on view public.chain_properties_participant is
  'Chain topology for participants; address/postcode visible only for own properties.';

revoke all on public.chain_properties_participant from public;
revoke all on public.chain_properties_participant from anon;
grant select on public.chain_properties_participant to authenticated;
