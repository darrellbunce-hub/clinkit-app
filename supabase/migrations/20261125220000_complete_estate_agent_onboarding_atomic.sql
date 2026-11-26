-- Batch 10 / EA-01: atomic founder company + branch + membership onboarding.
--
-- Problem: client-side multi-step inserts could leave an orphaned ea_companies
-- row (domain unique). Retries then incorrectly reported "already registered".
--
-- Solution: single SECURITY DEFINER RPC that creates/resumes all founding
-- records in one transaction. Domain ownership still comes from
-- profiles.email_domain (never a caller-chosen foreign domain).
--
-- LOCAL MIGRATION ONLY — do not apply to shared Development / Stage /
-- Production from this Batch without a controlled review.
-- This file has not been applied to Development, Stage, or Production.
--
-- A returned jsonb {ok:false} does not roll back earlier writes in this
-- function. profile_update_failed therefore raises so the company, branch,
-- and membership inserts abort with the profile update.
--
-- Rollback:
--   drop function if exists public.complete_estate_agent_onboarding(text, text, text, text, boolean, text);

create or replace function public.complete_estate_agent_onboarding(
  p_company_name text,
  p_branch_name text,
  p_town_or_city text,
  p_postcode text,
  p_is_head_office boolean default true,
  p_region_code text default 'UK-OTHER'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_email_domain text;
  v_company_name text := trim(coalesce(p_company_name, ''));
  v_branch_name text := trim(coalesce(p_branch_name, ''));
  v_town_or_city text := trim(coalesce(p_town_or_city, ''));
  v_postcode text := upper(regexp_replace(trim(coalesce(p_postcode, '')), '\s+', ' ', 'g'));
  v_region_code text := trim(coalesce(nullif(trim(p_region_code), ''), 'UK-OTHER'));
  v_is_head_office boolean := coalesce(p_is_head_office, true);
  v_company public.ea_companies%rowtype;
  v_branch public.ea_branches%rowtype;
  v_existing_company_id uuid;
  v_existing_owner uuid;
  v_recovered boolean := false;
  v_profile_updated integer := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_required');
  end if;

  if v_profile.account_type is distinct from 'estate_agent' then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_account_required');
  end if;

  v_email_domain := lower(trim(coalesce(v_profile.email_domain, '')));

  if v_email_domain = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'email_domain_required'
    );
  end if;

  if char_length(v_company_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_company_name');
  end if;

  if char_length(v_branch_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_branch_name');
  end if;

  if char_length(v_town_or_city) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_town_or_city');
  end if;

  if char_length(v_postcode) < 5
     or v_postcode !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?(\s*[0-9][A-Z]{2})?$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_postcode');
  end if;

  if char_length(v_region_code) < 2 then
    v_region_code := 'UK-OTHER';
  end if;

  -- Idempotent success when already onboarded with a branch membership.
  if v_profile.onboarding_completed_at is not null then
    select b.*
    into v_branch
    from public.ea_branch_members bm
    inner join public.ea_branches b
      on b.id = bm.branch_id
    where bm.user_id = v_user_id
    order by
      case when bm.role = 'branch_admin' then 0 else 1 end,
      b.created_at asc
    limit 1;

    if found then
      select c.*
      into v_company
      from public.ea_companies c
      where c.id = v_branch.company_id;

      return jsonb_build_object(
        'ok', true,
        'recovered', false,
        'already_completed', true,
        'company_id', v_company.id,
        'branch_id', v_branch.id,
        'company_name', v_company.name,
        'branch_name', v_branch.name,
        'town_or_city', v_branch.town_or_city,
        'postcode', v_branch.postcode
      );
    end if;
  end if;

  -- Resume incomplete founder-owned company for this domain (same uid).
  select c.*
  into v_company
  from public.ea_companies c
  where c.created_by_user_id = v_user_id
    and lower(c.email_domain) = v_email_domain
  order by c.created_at asc
  limit 1
  for update;

  if found then
    v_recovered := true;
  else
    begin
      insert into public.ea_companies (
        name,
        email_domain,
        created_by_user_id
      )
      values (
        v_company_name,
        v_email_domain,
        v_user_id
      )
      returning * into v_company;
    exception
      when unique_violation then
        select c.id, c.created_by_user_id
        into v_existing_company_id, v_existing_owner
        from public.ea_companies c
        where lower(c.email_domain) = v_email_domain
        limit 1;

        if v_existing_owner is not distinct from v_user_id then
          select c.*
          into v_company
          from public.ea_companies c
          where c.id = v_existing_company_id
          for update;
          v_recovered := true;
        else
          return jsonb_build_object(
            'ok', false,
            'error', 'domain_already_registered'
          );
        end if;
    end;
  end if;

  -- Keep the latest submitted company name while completing / resuming.
  if v_company.name is distinct from v_company_name then
    update public.ea_companies
    set
      name = v_company_name,
      updated_at = now()
    where id = v_company.id
    returning * into v_company;
  end if;

  select b.*
  into v_branch
  from public.ea_branches b
  where b.company_id = v_company.id
  order by
    case when b.is_head_office then 0 else 1 end,
    b.created_at asc
  limit 1
  for update;

  if not found then
    insert into public.ea_branches (
      company_id,
      name,
      town_or_city,
      postcode,
      region_code,
      is_head_office
    )
    values (
      v_company.id,
      v_branch_name,
      v_town_or_city,
      v_postcode,
      v_region_code,
      v_is_head_office
    )
    returning * into v_branch;
  else
    -- Do not flip head-office flags on resume (unique head-office index).
    update public.ea_branches
    set
      name = v_branch_name,
      town_or_city = v_town_or_city,
      postcode = v_postcode,
      region_code = v_region_code,
      updated_at = now()
    where id = v_branch.id
    returning * into v_branch;
  end if;

  insert into public.ea_branch_members (
    branch_id,
    user_id,
    role
  )
  values (
    v_branch.id,
    v_user_id,
    'branch_admin'
  )
  on conflict (branch_id, user_id) do update
    set role = excluded.role;

  update public.profiles
  set onboarding_completed_at = coalesce(
    onboarding_completed_at,
    now()
  )
  where id = v_user_id
    and account_type = 'estate_agent';

  get diagnostics v_profile_updated = row_count;

  -- Must raise. Returning ok false here would commit the company, branch,
  -- and membership rows above. Retry after this exception starts clean
  -- unless a previously committed incomplete company still exists to resume.
  if v_profile_updated is distinct from 1 then
    raise exception 'profile_update_failed'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'recovered', v_recovered,
    'already_completed', false,
    'company_id', v_company.id,
    'branch_id', v_branch.id,
    'company_name', v_company.name,
    'branch_name', v_branch.name,
    'town_or_city', v_branch.town_or_city,
    'postcode', v_branch.postcode
  );
end;
$$;

comment on function public.complete_estate_agent_onboarding(text, text, text, text, boolean, text) is
  'Atomic EA founder onboarding: company + first branch + branch_admin membership + onboarding_completed_at. Resumes incomplete founder-owned companies for the caller domain; refuses foreign domain claims. profile_update_failed raises so earlier inserts roll back.';

revoke all on function public.complete_estate_agent_onboarding(text, text, text, text, boolean, text)
  from public;

revoke all on function public.complete_estate_agent_onboarding(text, text, text, text, boolean, text)
  from anon;

grant execute on function public.complete_estate_agent_onboarding(text, text, text, text, boolean, text)
  to authenticated;
