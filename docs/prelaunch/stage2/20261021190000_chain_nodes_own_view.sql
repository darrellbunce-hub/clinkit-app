-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Own Buyer Ready nodes (blocker B2, read side, step 1 of 2). Additive only.
--
-- chain_nodes_select_participant lets every chain viewer read every node in
-- the chain, including chain_nodes.user_id. The app needs that column only to
-- recognise the viewer's own node (lib/operationalPosition.ts
-- findBuyerReadyNodeForUser, app/buyer-ready/[chainId]/page.tsx,
-- lib/ensureBuyerReadyOnJoin.ts). This view answers that question for the
-- caller alone, so 20261021200000 can stop authenticated reads of
-- chain_nodes.user_id without breaking own-node detection.
--
-- The view returns only rows where user_id = auth.uid(), so the only user id
-- it can return is the caller's own, and only in chains the caller can still
-- view (the same is_chain_operational_viewer test as
-- chain_nodes_select_participant), so it never returns a row the table
-- policy would hide. It runs as its owner (security_invoker = false) because
-- 20261021200000 removes the caller's SELECT privilege on
-- chain_nodes.user_id.
--
-- Order: apply this file, deploy b2-shared-chain-user-ids-app.patch, then
-- apply 20261021200000.
--
-- Rollback: drop view public.chain_nodes_own (after reverting the app patch).

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.chain_nodes') is null
     or to_regprocedure('public.is_chain_operational_viewer(bigint)') is null
  then
    raise exception 'chain_nodes_own aborted: public.chain_nodes or is_chain_operational_viewer is missing';
  end if;

  if to_regclass('public.chain_nodes_own') is not null then
    raise exception 'chain_nodes_own aborted: public.chain_nodes_own already exists';
  end if;

  if (
    select count(*)
    from pg_attribute a
    where a.attrelid = 'public.chain_nodes'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('id', 'chain_id', 'node_type', 'linked_property_id', 'user_id')
  ) <> 5 then
    raise exception 'chain_nodes_own aborted: chain_nodes columns differ';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) View
-- ---------------------------------------------------------------------------

create view public.chain_nodes_own
with (security_invoker = false)
as
select
  cn.id,
  cn.chain_id,
  cn.node_type,
  cn.linked_property_id,
  cn.user_id
from public.chain_nodes cn
where auth.uid() is not null
  and cn.user_id = auth.uid()
  and public.is_chain_operational_viewer(cn.chain_id);

alter view public.chain_nodes_own owner to postgres;

comment on view public.chain_nodes_own is
  'The caller''s own chain nodes. The only user id it returns is auth.uid(). Lets the app recognise its own Buyer Ready node without reading other participants'' chain_nodes.user_id (Business Rules 19.23, 24.7).';

revoke all on public.chain_nodes_own from public, anon, authenticated;
grant select on public.chain_nodes_own to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
begin
  if has_table_privilege('anon', 'public.chain_nodes_own', 'select')
     or not has_table_privilege('authenticated', 'public.chain_nodes_own', 'select')
     or has_table_privilege('authenticated', 'public.chain_nodes_own', 'insert')
     or has_table_privilege('authenticated', 'public.chain_nodes_own', 'update')
     or has_table_privilege('authenticated', 'public.chain_nodes_own', 'delete')
  then
    raise exception 'chain_nodes_own postflight: grants differ';
  end if;

  if pg_get_viewdef('public.chain_nodes_own'::regclass) not like '%auth.uid()%'
     or pg_get_viewdef('public.chain_nodes_own'::regclass) not like '%is_chain_operational_viewer%'
  then
    raise exception 'chain_nodes_own postflight: view is not scoped to the caller and viewable chains';
  end if;
end;
$$;
