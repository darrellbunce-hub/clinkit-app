-- Estate Agent branch directory: server-side search and eligibility.
--
-- Homeowner Estate Agent search loaded the first 200 rows of
-- ea_branch_directory (ordered by company and branch name) and filtered them in
-- the browser, so any branch sorting after row 200 could never be found. The
-- view also listed every branch except active smoke-test registry entries:
-- it applied neither Rule 17.15 (internal, smoke-test, development and fixture
-- branches never appear in customer-facing search) nor Rule 25.16 (a branch is
-- searchable and selectable only while entitled: trial, paid or payment-failure
-- grace).
--
-- 1) ea_branch_directory now lists only eligible branches:
--      - the branch, its company and the company creator are not on an active
--        smoke-test fixture;
--      - neither the company email domain nor the company creator's email
--        domain is a reserved test domain (.test, .example, .invalid,
--        .localhost, example.com/.net/.org);
--      - is_ea_branch_commercially_entitled(branch) is true, evaluated per
--        branch (open subscription, effective status entitled or unexpired
--        grace).
--    The view stays security_invoker = false and keeps its columns. Direct
--    reads of the view are filtered the same way as search.
-- 2) search_ea_branch_directory(query, limit) matches every search term
--    against company, branch, town and postcode before the row limit is
--    applied. SECURITY INVOKER over the view.
-- 3) get_property_ea_branch_entry(property) returns the branch labels of a
--    property's active assignment to callers who can already read that
--    assignment (property member, or member of the assigned branch), so an
--    assigned branch that is no longer eligible keeps its label.
--
-- No rows are changed by this migration. Assignment by branch id
-- (assign_property_ea_branch) is unchanged.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.ea_branch_directory') is null
     or to_regclass('public.ea_branches') is null
     or to_regclass('public.ea_companies') is null
     or to_regclass('public.ea_branch_members') is null
     or to_regclass('public.ea_branch_subscriptions') is null
     or to_regclass('public.smoke_test_fixtures') is null
     or to_regclass('public.smoke_test_fixture_objects') is null
     or to_regclass('public.property_ea_assignments') is null
  then
    raise exception 'ea_branch_directory_search_eligibility aborted: required relations are missing';
  end if;

  if to_regprocedure('public.is_ea_branch_commercially_entitled(uuid)') is null
     or to_regprocedure('public.is_property_member(bigint)') is null
  then
    raise exception 'ea_branch_directory_search_eligibility aborted: required helpers are missing';
  end if;

  if not has_function_privilege('authenticated', 'public.is_ea_branch_commercially_entitled(uuid)', 'execute') then
    raise exception 'ea_branch_directory_search_eligibility aborted: is_ea_branch_commercially_entitled must be executable by authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) ea_branch_directory — eligible branches only
-- ---------------------------------------------------------------------------

create or replace view public.ea_branch_directory
with (security_invoker = false)
as
select
  b.id as branch_id,
  b.name as branch_name,
  b.town_or_city,
  b.postcode,
  c.id as company_id,
  c.name as company_name
from public.ea_branches b
inner join public.ea_companies c
  on c.id = b.company_id
where not exists (
    select 1
    from public.smoke_test_fixture_objects o
    inner join public.smoke_test_fixtures f
      on f.id = o.fixture_id
    where f.status = 'active'
      and (
        (o.object_type = 'ea_branch' and o.object_id = b.id::text)
        or (o.object_type = 'ea_company' and o.object_id = c.id::text)
        or (o.object_type = 'auth_user' and o.object_id = c.created_by_user_id::text)
      )
  )
  and lower(btrim(c.email_domain))
    !~ '(^|\.)(test|example|invalid|localhost|example\.com|example\.net|example\.org)$'
  and not exists (
    select 1
    from auth.users u
    where u.id = c.created_by_user_id
      and lower(split_part(coalesce(u.email, ''), '@', 2))
        ~ '(^|\.)(test|example|invalid|localhost|example\.com|example\.net|example\.org)$'
  )
  and public.is_ea_branch_commercially_entitled(b.id);

comment on view public.ea_branch_directory is
  'Authenticated homeowner EA directory. Lists only eligible branches: not on an active smoke-test fixture (branch, company or company creator), no reserved test email domain on the company or its creator (Rule 17.15), and commercially entitled per branch — trial, paid or unexpired grace (Rule 25.16). Search through search_ea_branch_directory.';

revoke all on public.ea_branch_directory from public;
revoke all on public.ea_branch_directory from anon;
revoke all on public.ea_branch_directory from authenticated;
grant select on public.ea_branch_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 2) search_ea_branch_directory — terms matched before the limit
-- ---------------------------------------------------------------------------

create or replace function public.search_ea_branch_directory(
  p_query text,
  p_limit integer default 20
)
returns setof public.ea_branch_directory
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select lower(btrim(coalesce(p_query, ''))) as query
  ),
  parsed as (
    select (regexp_split_to_array(i.query, '\s+'))[1:8] as terms
    from input i
    where char_length(i.query) between 2 and 100
  )
  select d.*
  from public.ea_branch_directory d
  cross join parsed s
  where not exists (
    select 1
    from unnest(s.terms) as term
    where strpos(
      lower(concat_ws(' ', d.company_name, d.branch_name, d.town_or_city, d.postcode)),
      term
    ) = 0
  )
  order by d.company_name, d.branch_name, d.branch_id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

comment on function public.search_ea_branch_directory(text, integer) is
  'Homeowner EA search over ea_branch_directory (eligible branches only). Every whitespace-separated term (2–100 characters overall, first 8 terms) must appear in company, branch, town or postcode; matching happens before the limit (1–50, default 20).';

revoke all on function public.search_ea_branch_directory(text, integer) from public, anon;
grant execute on function public.search_ea_branch_directory(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) get_property_ea_branch_entry — label of the active assignment
-- ---------------------------------------------------------------------------

create or replace function public.get_property_ea_branch_entry(
  p_property_id bigint
)
returns table (
  branch_id uuid,
  branch_name text,
  town_or_city text,
  postcode text,
  company_id uuid,
  company_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.name,
    b.town_or_city,
    b.postcode,
    c.id,
    c.name
  from public.property_ea_assignments a
  inner join public.ea_branches b
    on b.id = a.branch_id
  inner join public.ea_companies c
    on c.id = b.company_id
  where auth.uid() is not null
    and a.property_id = p_property_id
    and a.status = 'active'
    and (
      public.is_property_member(a.property_id)
      or exists (
        select 1
        from public.ea_branch_members bm
        where bm.branch_id = a.branch_id
          and bm.user_id = auth.uid()
      )
    )
  limit 1;
$$;

comment on function public.get_property_ea_branch_entry(bigint) is
  'Branch and company labels for a property''s active EA assignment. Visible to the same callers as the assignment row (property member, or member of the assigned branch), whether or not the branch is still directory-eligible.';

revoke all on function public.get_property_ea_branch_entry(bigint) from public, anon;
grant execute on function public.get_property_ea_branch_entry(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1
    from pg_class
    where oid = 'public.ea_branch_directory'::regclass
      and 'security_invoker=false' = any (coalesce(reloptions, array[]::text[]))
  ) then
    raise exception 'ea_branch_directory_search_eligibility postflight: view must keep security_invoker = false';
  end if;

  if not has_table_privilege('authenticated', 'public.ea_branch_directory', 'select')
     or has_table_privilege('authenticated', 'public.ea_branch_directory', 'insert')
     or has_table_privilege('authenticated', 'public.ea_branch_directory', 'update')
     or has_table_privilege('authenticated', 'public.ea_branch_directory', 'delete')
     or has_table_privilege('anon', 'public.ea_branch_directory', 'select')
  then
    raise exception 'ea_branch_directory_search_eligibility postflight: view grants must be authenticated SELECT only';
  end if;

  select p.prosecdef
  into v_definer
  from pg_proc p
  where p.oid = to_regprocedure('public.search_ea_branch_directory(text, integer)');

  if v_definer is distinct from false then
    raise exception 'ea_branch_directory_search_eligibility postflight: search function missing or not SECURITY INVOKER';
  end if;

  select p.prosecdef, p.proconfig
  into v_definer, v_config
  from pg_proc p
  where p.oid = to_regprocedure('public.get_property_ea_branch_entry(bigint)');

  if v_definer is distinct from true
     or not ('search_path=public' = any (coalesce(v_config, array[]::text[])))
  then
    raise exception 'ea_branch_directory_search_eligibility postflight: label function missing or not SECURITY DEFINER with search_path = public';
  end if;

  if has_function_privilege('anon', 'public.search_ea_branch_directory(text, integer)', 'execute')
     or has_function_privilege('anon', 'public.get_property_ea_branch_entry(bigint)', 'execute')
  then
    raise exception 'ea_branch_directory_search_eligibility postflight: functions are anon-executable';
  end if;

  if not has_function_privilege('authenticated', 'public.search_ea_branch_directory(text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_property_ea_branch_entry(bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.search_ea_branch_directory(text, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.get_property_ea_branch_entry(bigint)', 'execute')
  then
    raise exception 'ea_branch_directory_search_eligibility postflight: grants missing';
  end if;
end;
$$;
