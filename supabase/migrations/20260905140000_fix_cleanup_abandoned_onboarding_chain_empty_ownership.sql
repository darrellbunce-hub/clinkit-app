-- P1: Require ownership on empty-chain cleanup in cleanup_abandoned_onboarding_chain.
--
-- Root cause: when a chain has zero properties, the RPC deleted chain_nodes/chains
-- without checking chains.created_by_user_id = auth.uid(). Any authenticated user
-- who knew/guessed a chain_id could delete another user's abandoned empty chain.
--
-- Intended caller: app/join-chain/page.tsx after successful join, cleaning up the
-- caller's Start Move sourceChain (created by the same user via
-- create_chain_for_onboarding).
--
-- Fix: empty-chain path requires the chain to exist and created_by_user_id =
-- auth.uid() before delete. Non-empty path ownership logic unchanged.
--
-- Does not change EXECUTE grants, RLS, or introduce new client-callable helpers.

create or replace function public.cleanup_abandoned_onboarding_chain(
  p_chain_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
  ) then
    -- Empty / missing chain: only the creator may delete.
    if not exists (
      select 1
      from public.chains c
      where c.id = p_chain_id
        and c.created_by_user_id = v_user_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_authorized');
    end if;

    delete from public.chain_nodes
    where chain_id = p_chain_id;

    delete from public.chains
    where id = p_chain_id
      and created_by_user_id = v_user_id;

    return jsonb_build_object('ok', true, 'empty_chain', true);
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and p.created_by_user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if exists (
    select 1
    from public.property_members pm
    inner join public.properties p
      on p.id = pm.property_id
    where p.chain_id = p_chain_id
      and pm.user_id <> v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'other_participants');
  end if;

  delete from public.activities
  where property_id in (
    select id from public.properties where chain_id = p_chain_id
  );

  delete from public.activities
  where chain_node_id in (
    select id from public.chain_nodes where chain_id = p_chain_id
  );

  delete from public.property_members
  where property_id in (
    select id from public.properties where chain_id = p_chain_id
  );

  delete from public.properties
  where chain_id = p_chain_id;

  delete from public.chain_nodes
  where chain_id = p_chain_id;

  delete from public.chains
  where id = p_chain_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.cleanup_abandoned_onboarding_chain(bigint) is
  'Removes an abandoned onboarding chain owned by the caller. Empty chains require chains.created_by_user_id = auth.uid(); non-empty chains require a property created by the caller and no other participants.';

-- Preserve existing public EXECUTE surface (no broadening).
revoke all on function public.cleanup_abandoned_onboarding_chain(bigint) from public;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint) to authenticated;
