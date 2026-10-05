-- Activity visibility for every operational viewer of a chain.
--
-- activities_select_chain_participant resolved a property activity's chain
-- through an EXISTS subquery on public.properties. That subquery ran under the
-- caller's own properties RLS (members, assigned agents, creators of unclaimed
-- rows), so activity on a chain property the caller cannot read directly was
-- silently dropped, even though the caller is an operational viewer of that
-- chain and already receives the property's stage and status through
-- chain_properties_participant.
--
-- is_property_chain_operational_viewer resolves the property's chain with
-- definer rights and returns only a boolean for the calling user. The
-- properties policies, chain_properties_participant and address/postcode
-- visibility are unchanged. The Buyer Ready (chain_node_id) branch already
-- resolved through chain_nodes, whose SELECT policy is the same operational
-- viewer predicate, and is kept as it was.
--
-- No data is changed; no activity rows are created.

do $$
begin
  if to_regprocedure('public.is_chain_operational_viewer(bigint)') is null then
    raise exception 'activities_select_property_chain_viewer aborted: is_chain_operational_viewer(bigint) is missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activities'
      and policyname = 'activities_select_chain_participant'
      and cmd = 'SELECT'
  ) then
    raise exception 'activities_select_property_chain_viewer aborted: activities_select_chain_participant is missing';
  end if;
end;
$$;

create temp table _activities_select_properties_policies as
select policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'properties';

create or replace function public.is_property_chain_operational_viewer(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.properties p
      where p.id = p_property_id
        and public.is_chain_operational_viewer(p.chain_id)
    );
$$;

alter function public.is_property_chain_operational_viewer(bigint) owner to postgres;

comment on function public.is_property_chain_operational_viewer(bigint) is
  'RLS predicate for activities: true when the caller is an operational viewer of the chain holding the property. Returns no property data.';

revoke all on function public.is_property_chain_operational_viewer(bigint) from public, anon;
grant execute on function public.is_property_chain_operational_viewer(bigint) to authenticated, service_role;

drop policy if exists activities_select_chain_participant
  on public.activities;

create policy activities_select_chain_participant
  on public.activities
  for select
  to authenticated
  using (
    (
      property_id is not null
      and public.is_property_chain_operational_viewer(property_id)
    )
    or (
      chain_node_id is not null
      and exists (
        select 1
        from public.chain_nodes cn
        where cn.id = activities.chain_node_id
          and public.is_chain_operational_viewer(cn.chain_id)
      )
    )
  );

do $$
declare
  v_proc oid := to_regprocedure('public.is_property_chain_operational_viewer(bigint)');
  v_qual text;
begin
  if v_proc is null then
    raise exception 'activities_select_property_chain_viewer postflight: helper missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = v_proc
      and p.prosecdef
      and p.provolatile = 's'
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.prorettype = 'boolean'::regtype
      and 'search_path=public' = any (coalesce(p.proconfig, '{}'::text[]))
  ) then
    raise exception 'activities_select_property_chain_viewer postflight: helper must be a stable SECURITY DEFINER boolean owned by postgres with search_path=public';
  end if;

  if exists (
    select 1
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_proc
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'activities_select_property_chain_viewer postflight: PUBLIC can execute the helper';
  end if;

  if has_function_privilege('anon', v_proc, 'execute') then
    raise exception 'activities_select_property_chain_viewer postflight: anon can execute the helper';
  end if;

  if not has_function_privilege('authenticated', v_proc, 'execute') then
    raise exception 'activities_select_property_chain_viewer postflight: authenticated cannot execute the helper (RLS would fail)';
  end if;

  select qual into v_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'activities'
    and policyname = 'activities_select_chain_participant'
    and cmd = 'SELECT';

  if v_qual is null
    or position('is_property_chain_operational_viewer(property_id)' in v_qual) = 0
    or position('FROM properties' in v_qual) > 0
  then
    raise exception 'activities_select_property_chain_viewer postflight: activities SELECT policy not replaced';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'activities'
      and cmd in ('SELECT', 'ALL')
  ) <> 1 then
    raise exception 'activities_select_property_chain_viewer postflight: unexpected additional activities SELECT policies';
  end if;

  if exists (
    (select policyname, cmd, permissive, roles, qual, with_check from _activities_select_properties_policies
     except
     select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'properties')
    union all
    (select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'properties'
     except
     select policyname, cmd, permissive, roles, qual, with_check from _activities_select_properties_policies)
  ) then
    raise exception 'activities_select_property_chain_viewer postflight: properties policies changed';
  end if;

  if has_table_privilege('anon', 'public.activities', 'select') then
    raise exception 'activities_select_property_chain_viewer postflight: anon can read activities';
  end if;
end;
$$;

drop table _activities_select_properties_policies;
