-- Fix persist_property_analytics_snapshot ROW_COUNT type mismatch.
--
-- v_inserted was declared boolean but assigned integer ROW_COUNT, causing:
--   operator does not exist: boolean > integer
-- on repeated snapshot creation (ON CONFLICT DO NOTHING, row_count = 0).

create or replace function public.persist_property_analytics_snapshot(
  p_property_id bigint,
  p_payload jsonb,
  p_snapshot_kind text default 'operational_release'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_ref uuid;
  v_chain_ref uuid;
  v_row_count integer := 0;
begin
  if p_payload is null or p_payload = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'empty_payload');
  end if;

  v_property_ref := coalesce(
    nullif(p_payload ->> 'propertyRef', '')::uuid,
    gen_random_uuid()
  );

  v_chain_ref := nullif(p_payload ->> 'chainRef', '')::uuid;

  insert into public.property_analytics_snapshots (
    property_ref,
    chain_ref,
    source_property_id,
    snapshot_version,
    snapshot_kind,
    payload,
    captured_at
  )
  values (
    v_property_ref,
    v_chain_ref,
    p_property_id,
    coalesce((p_payload ->> 'snapshotVersion')::integer, 1),
    coalesce(nullif(trim(p_snapshot_kind), ''), 'operational_release'),
    p_payload,
    now()
  )
  on conflict (source_property_id, snapshot_kind)
  where source_property_id is not null
  do nothing;

  get diagnostics v_row_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'inserted', v_row_count > 0,
    'idempotent', v_row_count = 0
  );
end;
$$;

comment on function public.persist_property_analytics_snapshot(bigint, jsonb, text) is
  'Idempotent analytics snapshot persistence. ROW_COUNT distinguishes insert vs ON CONFLICT skip.';
