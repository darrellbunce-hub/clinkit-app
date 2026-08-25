-- Fix EA onboarding: ea_companies_insert_founding must not read auth.users.
--
-- The authenticated role cannot SELECT auth.users. The founding insert policy
-- previously used auth.users as a fallback for email domain matching, which
-- caused: permission denied for table users (42501).
--
-- profiles.email_domain is set at estate agent signup and is authoritative.

drop policy if exists ea_companies_insert_founding
  on public.ea_companies;

create policy ea_companies_insert_founding
  on public.ea_companies
  for insert
  to authenticated
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.account_type = 'estate_agent'
        and p.email_domain is not null
        and trim(p.email_domain) <> ''
        and lower(email_domain) = lower(p.email_domain)
    )
  );

comment on policy ea_companies_insert_founding on public.ea_companies is
  'Founding estate agent creates their company during onboarding. Email domain must match profiles.email_domain.';
