-- Deduplicate property_members and enforce one membership row per (property_id, user_id).
--
-- Prerequisite: run against the same Supabase project as the application
-- (NEXT_PUBLIC_SUPABASE_URL). Rollback plan in migration footer comments.

-- ---------------------------------------------------------------------------
-- Step 1: Audit (logged; does not mutate)
-- ---------------------------------------------------------------------------

do $$
declare
  v_duplicate_groups bigint;
  v_duplicate_rows bigint;
begin
  select
    count(*),
    coalesce(sum(c - 1), 0)
  into
    v_duplicate_groups,
    v_duplicate_rows
  from (
    select count(*) as c
    from public.property_members
    group by property_id, user_id
    having count(*) > 1
  ) d;

  raise notice 'property_members audit: % duplicate (property_id, user_id) groups, % excess rows to remove',
    v_duplicate_groups,
    v_duplicate_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Remove duplicate rows (retain canonical membership per pair)
-- ---------------------------------------------------------------------------
-- Canonical preference matches current_user_property_role:
-- seller > buyer > participant > other; then oldest id.

with ranked as (
  select
    pm.id,
    row_number() over (
      partition by pm.property_id, pm.user_id
      order by
        case pm.role
          when 'seller' then 1
          when 'buyer' then 2
          when 'participant' then 3
          else 4
        end,
        pm.id asc
    ) as rn
  from public.property_members pm
),
to_delete as (
  select id from ranked where rn > 1
)
delete from public.property_members pm
using to_delete d
where pm.id = d.id;

-- ---------------------------------------------------------------------------
-- Step 3: Verify zero duplicate groups remain
-- ---------------------------------------------------------------------------

do $$
declare
  v_remaining bigint;
begin
  select count(*)
  into v_remaining
  from (
    select 1
    from public.property_members
    group by property_id, user_id
    having count(*) > 1
  ) d;

  if v_remaining > 0 then
    raise exception
      'property_members deduplication failed: % duplicate groups remain',
      v_remaining;
  end if;

  raise notice 'property_members deduplication verified: 0 duplicate groups';
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 4: Unique constraint
-- ---------------------------------------------------------------------------

alter table public.property_members
  drop constraint if exists property_members_one_user_per_property;

alter table public.property_members
  add constraint property_members_one_user_per_property
  unique (property_id, user_id);

-- ---------------------------------------------------------------------------
-- Step 5: Idempotent membership helper (authenticated caller only)
-- ---------------------------------------------------------------------------

create or replace function public.ensure_property_membership(
  p_property_id bigint,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.property_members (
    property_id,
    user_id,
    role
  )
  values (
    p_property_id,
    v_user_id,
    p_role
  )
  on conflict (property_id, user_id) do update
  set role = case
    when case public.property_members.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    <= case excluded.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    then public.property_members.role
    else excluded.role
  end;
end;
$$;

comment on function public.ensure_property_membership(bigint, text) is
  'Idempotent membership for the current user; prefers seller/buyer over legacy roles on conflict.';

revoke all on function public.ensure_property_membership(bigint, text) from public;
grant execute on function public.ensure_property_membership(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 6: Harden join_chain_property to use ensure_property_membership
-- ---------------------------------------------------------------------------

create or replace function public.join_chain_property(
  p_access_code text,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_role text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select c.id
  into v_chain_id
  from public.chains c
  where c.access_code = p_access_code;

  if v_chain_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  select *
  into v_property
  from public.properties p
  where p.chain_id = v_chain_id
    and p.address = p_address
    and p.postcode = p_postcode;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  update public.properties
  set
    status = 'healthy',
    buyer_connected = case
      when v_property.relationship_type in ('sale', 'purchase') then true
      else buyer_connected
    end,
    seller_connected = case
      when v_property.relationship_type = 'purchase' then true
      else seller_connected
    end
  where id = v_property.id;

  v_role := case
    when v_property.relationship_type = 'sale' then 'buyer'
    else 'seller'
  end;

  perform public.ensure_property_membership(v_property.id, v_role);

  select *
  into v_property
  from public.properties
  where id = v_property.id;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id,
    'linked_property_id', v_property.linked_property_id,
    'relationship_type', v_property.relationship_type,
    'joining_role', v_role
  );
end;
$$;

revoke all on function public.join_chain_property(text, text, text) from public;
grant execute on function public.join_chain_property(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Rollback plan (manual — run only if reverting this migration)
-- ---------------------------------------------------------------------------
-- 1. DROP CONSTRAINT property_members_one_user_per_property;
-- 2. DROP FUNCTION public.ensure_property_membership(bigint, text);
-- 3. Restore join_chain_property from 20260610200000 if needed.
-- Note: deleted duplicate rows cannot be restored without a backup.
