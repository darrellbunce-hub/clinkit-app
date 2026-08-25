-- Fix EA onboarding: allow founders to read companies/branches they create
-- before branch membership exists.
--
-- INSERT into ea_companies / ea_branches succeeds, but PostgREST
-- .insert().select("id").single() requires SELECT policy on RETURNING.
-- ea_*_select_members previously required is_ea_company_member(), which is
-- false until ea_branch_members is inserted.

-- ---------------------------------------------------------------------------
-- ea_companies: founder may read companies they created
-- ---------------------------------------------------------------------------

drop policy if exists ea_companies_select_members
  on public.ea_companies;

create policy ea_companies_select_members
  on public.ea_companies
  for select
  to authenticated
  using (
    created_by_user_id = auth.uid()
    or public.is_ea_company_member(id)
  );

comment on policy ea_companies_select_members on public.ea_companies is
  'Company founder or any branch member may read the company record.';

-- ---------------------------------------------------------------------------
-- ea_branches: company founder may read branches during founding onboarding
-- ---------------------------------------------------------------------------

drop policy if exists ea_branches_select_members
  on public.ea_branches;

create policy ea_branches_select_members
  on public.ea_branches
  for select
  to authenticated
  using (
    public.is_ea_company_member(company_id)
    or exists (
      select 1
      from public.ea_companies c
      where c.id = ea_branches.company_id
        and c.created_by_user_id = auth.uid()
    )
  );

comment on policy ea_branches_select_members on public.ea_branches is
  'Branch members, or the founding company creator during onboarding, may read branch records.';
