-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Shared chain reads without other participants' user ids (blocker B2, read
-- side, step 2 of 2). Business Rules 19.23, 24.7.
--
-- Every chain viewer (is_chain_operational_viewer) can read every row of
-- these tables. The rows stay readable; only the user id columns stop being
-- readable by end users:
--   chains                  created_by_user_id,
--                           completion_date_recorded_by_user_id,
--                           completion_date_updated_by_user_id,
--                           completion_confirmed_by_user_id
--   chain_nodes             user_id
--   operational_delays      created_by_user_id, resolved_by_user_id
--   chain_completion_events actor_user_id
--
-- Method: replace authenticated's table-level SELECT with column-level SELECT
-- on every other column, computed from the catalog at apply time (the chains
-- base table predates the repository migrations, so its full column list is
-- not known offline). RLS policies, INSERT and UPDATE privileges, and
-- service_role are unchanged. Values are still written and kept: the
-- attribution guard (20261021170000), insert policies, event attribution and
-- owner-run functions use them server-side.
--
-- Requires, in order: 20261021190000 (chain_nodes_own), then
-- b2-shared-chain-user-ids-app.patch deployed. The current app reads
-- chains and chain_nodes with select('*'), which fails once any column is
-- unreadable.
--
-- Verify in Development before promotion (README B2 section):
--   - policies that reference a revoked column (chain_nodes_insert_owner,
--     chain_nodes_update_owner, chain_completion_events_insert_operator)
--     still admit their legitimate writes;
--   - PostgREST insert/update with .select('id') and without .select() does
--     not return a revoked column;
--   - columns added to these tables later are not readable by authenticated
--     until granted (fail closed; add them to a follow-up grant).
--
-- Rollback: grant select on each of the four tables to authenticated.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_spec record;
  v_col text;
  v_found integer;
  v_views text;
begin
  for v_spec in
    select * from (values
      ('public.chains', array['created_by_user_id', 'completion_date_recorded_by_user_id', 'completion_date_updated_by_user_id', 'completion_confirmed_by_user_id']),
      ('public.chain_nodes', array['user_id']),
      ('public.operational_delays', array['created_by_user_id', 'resolved_by_user_id']),
      ('public.chain_completion_events', array['actor_user_id'])
    ) as t(tbl, cols)
  loop
    if to_regclass(v_spec.tbl) is null then
      raise exception 'shared_chain_user_ids aborted: % is missing', v_spec.tbl;
    end if;

    if not has_table_privilege('authenticated', v_spec.tbl, 'select') then
      raise exception 'shared_chain_user_ids aborted: authenticated has no table-level SELECT on %', v_spec.tbl;
    end if;

    if has_table_privilege('anon', v_spec.tbl, 'select') then
      raise exception 'shared_chain_user_ids aborted: anon can read %', v_spec.tbl;
    end if;

    foreach v_col in array v_spec.cols
    loop
      select count(*) into v_found
      from pg_attribute a
      where a.attrelid = v_spec.tbl::regclass
        and a.attname = v_col
        and a.attnum > 0
        and not a.attisdropped;

      if v_found <> 1 then
        raise exception 'shared_chain_user_ids aborted: %.% is missing', v_spec.tbl, v_col;
      end if;

      -- A security_invoker view reading the column would start failing.
      select string_agg(distinct v.oid::regclass::text, ', ') into v_views
      from pg_depend d
      inner join pg_rewrite r on r.oid = d.objid
      inner join pg_class v on v.oid = r.ev_class
      inner join pg_attribute a
        on a.attrelid = d.refobjid
       and a.attnum = d.refobjsubid
      where d.classid = 'pg_rewrite'::regclass
        and d.refobjid = v_spec.tbl::regclass
        and a.attname = v_col
        and v.oid <> d.refobjid
        and coalesce(array_to_string(v.reloptions, ','), '') like '%security_invoker=true%';

      if v_views is not null then
        raise exception 'shared_chain_user_ids aborted: security_invoker views read %.%: %', v_spec.tbl, v_col, v_views;
      end if;
    end loop;
  end loop;

  if to_regclass('public.chain_nodes_own') is null then
    raise exception 'shared_chain_user_ids aborted: apply 20261021190000 and deploy the B2 app patch first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Column-level SELECT
-- ---------------------------------------------------------------------------

do $$
declare
  v_spec record;
  v_cols text;
begin
  for v_spec in
    select * from (values
      ('public.chains', array['created_by_user_id', 'completion_date_recorded_by_user_id', 'completion_date_updated_by_user_id', 'completion_confirmed_by_user_id']),
      ('public.chain_nodes', array['user_id']),
      ('public.operational_delays', array['created_by_user_id', 'resolved_by_user_id']),
      ('public.chain_completion_events', array['actor_user_id'])
    ) as t(tbl, cols)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
    where a.attrelid = v_spec.tbl::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname <> all (v_spec.cols);

    execute format('revoke select on table %s from authenticated', v_spec.tbl);
    execute format(
      'revoke select (%s) on table %s from authenticated',
      (select string_agg(quote_ident(c), ', ') from unnest(v_spec.cols) c),
      v_spec.tbl
    );
    execute format('grant select (%s) on table %s to authenticated', v_cols, v_spec.tbl);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_spec record;
  v_col record;
begin
  for v_spec in
    select * from (values
      ('public.chains', array['created_by_user_id', 'completion_date_recorded_by_user_id', 'completion_date_updated_by_user_id', 'completion_confirmed_by_user_id']),
      ('public.chain_nodes', array['user_id']),
      ('public.operational_delays', array['created_by_user_id', 'resolved_by_user_id']),
      ('public.chain_completion_events', array['actor_user_id'])
    ) as t(tbl, cols)
  loop
    for v_col in
      select a.attname
      from pg_attribute a
      where a.attrelid = v_spec.tbl::regclass
        and a.attnum > 0
        and not a.attisdropped
    loop
      if has_column_privilege('authenticated', v_spec.tbl, v_col.attname, 'select')
         is distinct from not (v_col.attname = any (v_spec.cols))
      then
        raise exception 'shared_chain_user_ids postflight: %.% readability differs', v_spec.tbl, v_col.attname;
      end if;

      if has_column_privilege('anon', v_spec.tbl, v_col.attname, 'select') then
        raise exception 'shared_chain_user_ids postflight: anon can read %.%', v_spec.tbl, v_col.attname;
      end if;
    end loop;

    if not has_column_privilege('service_role', v_spec.tbl, v_spec.cols[1], 'select') then
      raise exception 'shared_chain_user_ids postflight: service_role lost %.%', v_spec.tbl, v_spec.cols[1];
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.chain_nodes', 'insert')
     or not has_table_privilege('authenticated', 'public.chain_nodes', 'update')
     or not has_table_privilege('authenticated', 'public.chains', 'update')
     or not has_table_privilege('authenticated', 'public.chain_completion_events', 'insert')
     or has_table_privilege('authenticated', 'public.operational_delays', 'insert')
  then
    raise exception 'shared_chain_user_ids postflight: write privileges changed';
  end if;
end;
$$;
