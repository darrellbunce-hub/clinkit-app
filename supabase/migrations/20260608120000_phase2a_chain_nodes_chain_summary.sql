-- Phase 2a: participant-safe Buyer Ready summary layer
--
-- Goals:
-- - Do NOT add or widen SELECT policies on the base chain_nodes table.
-- - Expose only participant-safe columns for chain topology rendering.
-- - Filter rows to authenticated chain participants via auth.uid().
--
-- The view runs as its owner (security_invoker = false, Postgres default) so it
-- can read chain_nodes without changing base-table RLS. Row filtering uses the
-- caller's JWT via auth.uid() inside the view definition.

create or replace view public.chain_nodes_chain_summary
with (security_invoker = false)
as
select
  cn.id,
  cn.chain_id,
  cn.node_type,
  cn.position,
  cn.linked_property_id,
  cn.status,
  cn.progress,
  case
    when cn.stage is null then 'Buyer Ready'
    when cn.stage like 'mortgage%' then 'Mortgage preparation'
    when cn.stage in (
      'solicitor_instructed',
      'searches_ordered'
    ) then 'Conveyancing in progress'
    when cn.stage like 'survey%' then 'Survey in progress'
    when cn.stage like 'enquir%'
      or cn.stage like 'contract%' then 'Legal work in progress'
    when cn.stage in (
      'ready_to_exchange',
      'exchange_contracts',
      'completion_date_agreed'
    ) then 'Approaching exchange'
    else 'Buyer Ready'
  end as public_stage_label,
  (
    select a.timestamp
    from public.activities a
    where a.chain_node_id = cn.id
    order by a.timestamp desc
    limit 1
  ) as latest_activity_at
from public.chain_nodes cn
where
  cn.node_type = 'buyer_ready'
  and auth.uid() is not null
  and exists (
    select 1
    from public.properties p
    inner join public.property_members pm
      on pm.property_id = p.id
    where p.chain_id = cn.chain_id
      and pm.user_id = auth.uid()
  );

comment on view public.chain_nodes_chain_summary is
  'Participant-safe Buyer Ready projection for shared chain topology rendering.';

-- Prevent anonymous API access; authenticated users only.
revoke all on public.chain_nodes_chain_summary from public;
revoke all on public.chain_nodes_chain_summary from anon;
grant select on public.chain_nodes_chain_summary to authenticated;
