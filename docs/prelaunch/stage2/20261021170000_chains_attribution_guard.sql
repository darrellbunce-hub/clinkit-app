-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- chains attribution guard (blocker B2, write side). Independent of the
-- other files.
--
-- chains_insert_authenticated only requires a signed-in caller and
-- chains_update_operator (20261005120000) lets any operator of the chain
-- update the row, so a direct client write can set created_by_user_id,
-- completion_date_recorded_by_user_id, completion_date_updated_by_user_id
-- or completion_confirmed_by_user_id to another user's id. For direct
-- client writes (current_user = 'authenticated') a BEFORE trigger now:
--   - on insert, sets created_by_user_id to auth.uid() and any non-null
--     completion attribution to auth.uid();
--   - on update, keeps created_by_user_id and replaces any changed,
--     non-null completion attribution with auth.uid().
-- The app only ever writes the caller's own id into these columns
-- (lib/recordChainCompletionDate.ts, amendChainCompletionDate.ts,
-- confirmChainCompletion.ts) and creates chains through SECURITY DEFINER
-- RPCs or, for the smoke-test fixture, as service_role
-- (lib/smokeTest/createSyntheticFixture.ts), so no legitimate write changes. Owner-run functions and
-- service_role are not affected. Clearing a column to null is still allowed
-- (record clears completion_date_updated_by_user_id).
--
-- Read side: these ids stay readable by chain viewers until the B2 app
-- change lands (README section 7).
--
-- Rollback: drop trigger trg_chains_enforce_attribution on public.chains;
-- drop function public._trg_chains_enforce_attribution().

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_cols text;
begin
  if to_regclass('public.chains') is null then
    raise exception 'chains_attribution_guard aborted: public.chains is missing';
  end if;

  select string_agg(a.attname, ',' order by a.attname) into v_cols
  from pg_attribute a
  where a.attrelid = 'public.chains'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname in (
      'created_by_user_id',
      'completion_date_recorded_by_user_id',
      'completion_date_updated_by_user_id',
      'completion_confirmed_by_user_id'
    );

  if v_cols is distinct from 'completion_confirmed_by_user_id,completion_date_recorded_by_user_id,completion_date_updated_by_user_id,created_by_user_id' then
    raise exception 'chains_attribution_guard aborted: attribution columns differ';
  end if;

  if to_regprocedure('public._trg_chains_enforce_attribution()') is not null
     or exists (
       select 1 from pg_trigger t
       where t.tgrelid = 'public.chains'::regclass
         and t.tgname = 'trg_chains_enforce_attribution'
     )
  then
    raise exception 'chains_attribution_guard aborted: guard already exists';
  end if;

  -- Another BEFORE row trigger could run after this one and rewrite the
  -- columns; refuse rather than depend on trigger name order.
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.chains'::regclass
      and not t.tgisinternal
      and (t.tgtype & 2) = 2
  ) then
    raise exception 'chains_attribution_guard aborted: chains already has a BEFORE trigger';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Guard
-- ---------------------------------------------------------------------------

create or replace function public._trg_chains_enforce_attribution()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Only direct client writes; owner-run functions and service_role keep
  -- the values they set.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by_user_id := auth.uid();

    if new.completion_date_recorded_by_user_id is not null then
      new.completion_date_recorded_by_user_id := auth.uid();
    end if;

    if new.completion_date_updated_by_user_id is not null then
      new.completion_date_updated_by_user_id := auth.uid();
    end if;

    if new.completion_confirmed_by_user_id is not null then
      new.completion_confirmed_by_user_id := auth.uid();
    end if;

    return new;
  end if;

  new.created_by_user_id := old.created_by_user_id;

  if new.completion_date_recorded_by_user_id is not null
     and new.completion_date_recorded_by_user_id is distinct from old.completion_date_recorded_by_user_id
  then
    new.completion_date_recorded_by_user_id := auth.uid();
  end if;

  if new.completion_date_updated_by_user_id is not null
     and new.completion_date_updated_by_user_id is distinct from old.completion_date_updated_by_user_id
  then
    new.completion_date_updated_by_user_id := auth.uid();
  end if;

  if new.completion_confirmed_by_user_id is not null
     and new.completion_confirmed_by_user_id is distinct from old.completion_confirmed_by_user_id
  then
    new.completion_confirmed_by_user_id := auth.uid();
  end if;

  return new;
end;
$$;

alter function public._trg_chains_enforce_attribution() owner to postgres;

comment on function public._trg_chains_enforce_attribution() is
  'Direct client writes to chains: creator and completion attribution are the caller (Business Rules 3.4). Owner-run functions and service_role are not affected.';

revoke all on function public._trg_chains_enforce_attribution() from public, anon, authenticated;

create trigger trg_chains_enforce_attribution
  before insert or update on public.chains
  for each row
  execute function public._trg_chains_enforce_attribution();

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.chains'::regclass
      and t.tgname = 'trg_chains_enforce_attribution'
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1   -- row
      and (t.tgtype & 2) = 2   -- before
      and (t.tgtype & 4) = 4   -- insert
      and (t.tgtype & 16) = 16 -- update
  ) then
    raise exception 'chains_attribution_guard postflight: trigger not as intended';
  end if;

  if has_function_privilege('anon', 'public._trg_chains_enforce_attribution()', 'execute')
     or has_function_privilege('authenticated', 'public._trg_chains_enforce_attribution()', 'execute')
  then
    raise exception 'chains_attribution_guard postflight: trigger function is executable by end users';
  end if;
end;
$$;
