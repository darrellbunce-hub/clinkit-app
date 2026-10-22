-- PROPOSED — NOT RUN. Development-only rolled-back trial for the
-- 20261021130000 INSERT ... RETURNING regression.
--
-- Target: Development bbbsxzxcjkmpqsfvmhbo only, through
--   npx supabase db query --linked --project-ref bbbsxzxcjkmpqsfvmhbo --workdir <scratch> -f <absolute path>
-- The file is one implicit transaction and ends by raising TRIAL_RESULT, so
-- every write below (rate-limit rows, chains, properties, identities) is
-- rolled back. Nothing is applied. No schema object is created or replaced.
--
-- Expected TRIAL_RESULT (each step is isolated in its own sub-block):
--   T1 chain=ok
--   T2 direct_insert_returning=42501          (the original failure; refused by design)
--   T3 start_move_sale=ok visible=true       (RPC returns the id; caller can read the row)
--   T4 placeholder=ok created=true linked=true identity=start_move
--   T5 placeholder_retry=ok same_id=true created=false
--   T6 duplicate_sale=property_already_in_chain
--   T7 start_move_purchase=ok visible=true
--   T8 other_user_placeholder=not_authorized unknown_id=not_authorized
--   T9 authenticated_exec_property_has_any_member=false

do $$
declare
  v_user uuid;
  v_other uuid;
  v_res jsonb;
  v_chain bigint;
  v_chain2 bigint;
  v_sale bigint;
  v_purchase bigint;
  v_placeholder bigint;
  v_id bigint;
  v_tag text := upper(substr(md5(random()::text), 1, 6));
  r text := '';
begin
  select u.id into v_user
  from auth.users u
  where u.email_confirmed_at is not null
    and not public._is_estate_agent_account(u.id)
  order by u.created_at desc
  limit 1;

  select u.id into v_other
  from auth.users u
  where u.email_confirmed_at is not null
    and not public._is_estate_agent_account(u.id)
    and u.id <> v_user
  order by u.created_at desc
  limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    v_res := public.create_chain_for_onboarding('TRIAL-' || v_tag, 'KN-T' || v_tag);
    v_chain := (v_res ->> 'chain_id')::bigint;
    v_res := public.create_chain_for_onboarding('TRIAL2-' || v_tag, 'KN-U' || v_tag);
    v_chain2 := (v_res ->> 'chain_id')::bigint;
    r := r || 'T1 chain=' || case when v_chain is not null and v_chain2 is not null then 'ok' else coalesce(v_res ->> 'error', 'failed') end || '; ';
  exception when others then
    r := r || 'T1 chain=' || sqlstate || '; ';
  end;

  begin
    insert into public.properties (chain_id, chain_position, address, postcode, stage, status, relationship_type, created_by_user_id, buyer_connected, seller_connected, is_searching)
    values (v_chain, 9, 'TRIAL DIRECT ' || v_tag, 'PO16 7AA', 'property_listed', 'pending_connection', 'sale', v_user, false, true, false)
    returning id into v_id;
    r := r || 'T2 direct_insert_returning=ok; ';
  exception when others then
    r := r || 'T2 direct_insert_returning=' || sqlstate || '; ';
  end;

  begin
    v_res := public.start_move_create_property(v_chain, 'sale', 'TRIAL SALE ' || v_tag, 'PO16 7AB', false);
    v_sale := (v_res ->> 'property_id')::bigint;
    r := r || 'T3 start_move_sale=' || coalesce(case when (v_res ->> 'ok')::boolean then 'ok' end, v_res ->> 'error')
      || ' visible=' || exists (select 1 from public.properties p where p.id = v_sale)::text || '; ';
  exception when others then
    r := r || 'T3 start_move_sale=' || sqlstate || '; ';
  end;

  begin
    v_res := public.create_searching_placeholder_for_sale(v_sale);
    v_placeholder := (v_res ->> 'property_id')::bigint;
    r := r || 'T4 placeholder=' || coalesce(case when (v_res ->> 'ok')::boolean then 'ok' end, v_res ->> 'error')
      || ' created=' || coalesce(v_res ->> 'created', 'null')
      || ' linked=' || exists (select 1 from public.properties p where p.id = v_sale and p.linked_property_id = v_placeholder)::text
      || ' identity=' || coalesce((select poi.granted_via from public.property_operational_identities poi
                                   where poi.property_id = v_placeholder and poi.homeowner_user_id = v_user limit 1), 'none')
      || '; ';
  exception when others then
    r := r || 'T4 placeholder=' || sqlstate || '; ';
  end;

  begin
    v_res := public.create_searching_placeholder_for_sale(v_sale);
    r := r || 'T5 placeholder_retry=' || coalesce(case when (v_res ->> 'ok')::boolean then 'ok' end, v_res ->> 'error')
      || ' same_id=' || ((v_res ->> 'property_id')::bigint = v_placeholder)::text
      || ' created=' || coalesce(v_res ->> 'created', 'null') || '; ';
  exception when others then
    r := r || 'T5 placeholder_retry=' || sqlstate || '; ';
  end;

  begin
    v_res := public.start_move_create_property(v_chain, 'sale', 'TRIAL SALE B ' || v_tag, 'PO16 7AC', false);
    r := r || 'T6 duplicate_sale=' || coalesce(v_res ->> 'error', 'created_duplicate') || '; ';
  exception when others then
    r := r || 'T6 duplicate_sale=' || sqlstate || '; ';
  end;

  begin
    v_res := public.start_move_create_property(v_chain2, 'purchase', 'TRIAL BUY ' || v_tag, 'PO16 7AD', false);
    v_purchase := (v_res ->> 'property_id')::bigint;
    r := r || 'T7 start_move_purchase=' || coalesce(case when (v_res ->> 'ok')::boolean then 'ok' end, v_res ->> 'error')
      || ' visible=' || exists (select 1 from public.properties p where p.id = v_purchase)::text || '; ';
  exception when others then
    r := r || 'T7 start_move_purchase=' || sqlstate || '; ';
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    r := r || 'T8 other_user_placeholder=' || coalesce(public.create_searching_placeholder_for_sale(v_sale) ->> 'error', 'ok')
      || ' unknown_id=' || coalesce(public.create_searching_placeholder_for_sale(-1) ->> 'error', 'ok') || '; ';
  exception when others then
    r := r || 'T8 other_user_placeholder=' || sqlstate || '; ';
  end;

  execute 'reset role';
  r := r || 'T9 authenticated_exec_property_has_any_member='
    || has_function_privilege('authenticated', 'public.property_has_any_member(bigint)', 'execute')::text || '; ';

  raise exception 'TRIAL_RESULT: %', r;
end $$;
