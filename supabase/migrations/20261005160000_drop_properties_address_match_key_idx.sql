-- Restore authenticated writes to public.properties.
--
-- 20261005120000 added properties_address_match_key_idx on
-- _postcode_match_key(postcode) / _address_match_key(address). Both helpers
-- are service_role-only (20261005100000), and index expressions are evaluated
-- with the privileges of the writing role, so every authenticated INSERT into
-- properties (and any UPDATE that writes new index entries) failed with
-- "permission denied for function _postcode_match_key".
--
-- The index only accelerated _address_reservation_conflict; the conflict
-- check, its advisory lock and the reservation trigger are unchanged and stay
-- correct without it. The helper grants are unchanged.
--
-- The postflight also refuses any public table that authenticated can write
-- (or that has a policy) whose index, constraint, default or policy depends on
-- a function authenticated cannot execute.

drop index if exists public.properties_address_match_key_idx;

do $$
declare
  v_offender text;
begin
  if to_regclass('public.properties_address_match_key_idx') is not null then
    raise exception 'drop_properties_address_match_key_idx postflight: index still present';
  end if;

  with deps as (
    select 'index' as kind, ic.relname::text as object_name, i.indrelid as table_oid, d.refobjid as fn_oid
    from pg_depend d
    join pg_class ic on ic.oid = d.objid and d.classid = 'pg_class'::regclass
    join pg_index i on i.indexrelid = ic.oid
    where d.refclassid = 'pg_proc'::regclass
    union all
    select 'constraint', con.conname::text, con.conrelid, d.refobjid
    from pg_depend d
    join pg_constraint con on con.oid = d.objid and d.classid = 'pg_constraint'::regclass
    where d.refclassid = 'pg_proc'::regclass
      and con.conrelid <> 0
    union all
    select 'default', a.attname::text, ad.adrelid, d.refobjid
    from pg_depend d
    join pg_attrdef ad on ad.oid = d.objid and d.classid = 'pg_attrdef'::regclass
    join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
    where d.refclassid = 'pg_proc'::regclass
    union all
    select 'policy', pol.polname::text, pol.polrelid, d.refobjid
    from pg_depend d
    join pg_policy pol on pol.oid = d.objid and d.classid = 'pg_policy'::regclass
    where d.refclassid = 'pg_proc'::regclass
  )
  select string_agg(format('%s %s.%s -> %s', deps.kind, t.relname, deps.object_name, p.proname), ', ')
  into v_offender
  from deps
  join pg_class t on t.oid = deps.table_oid
  join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
  join pg_proc p on p.oid = deps.fn_oid
  where not has_function_privilege('authenticated', p.oid, 'execute')
    and (
      deps.kind = 'policy'
      or has_table_privilege('authenticated', t.oid, 'insert')
      or has_table_privilege('authenticated', t.oid, 'update')
    );

  if v_offender is not null then
    raise exception 'drop_properties_address_match_key_idx postflight: authenticated write path depends on a function it cannot execute: %', v_offender;
  end if;
end;
$$;
