-- Billing P1: Branch-level Stripe Customer isolation (Development-first).
-- Day 1 billing unit remains ea_branches.
-- Does NOT enable entitlement enforcement.
-- Does NOT implement organisation-tier billing.
--
-- Canonical Day 1 Stripe Customer: ea_branches.stripe_customer_id
-- ea_companies.stripe_customer_id retained for FUTURE organisation billing only
-- (not written by Day 1 Checkout/Portal paths).

-- ---------------------------------------------------------------------------
-- 1) Branch Stripe Customer (authoritative for Day 1 Portal / Checkout)
-- ---------------------------------------------------------------------------

alter table public.ea_branches
  add column if not exists stripe_customer_id text null;

comment on column public.ea_branches.stripe_customer_id is
  'Day 1 authoritative Stripe Customer for this branch. One Customer per branch; Portal/Checkout must use this id. Clients cannot mutate (see trigger).';

create unique index if not exists ea_branches_stripe_customer_id_uidx
  on public.ea_branches (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Prevent authenticated clients from forging Stripe Customer ids on branches
-- ---------------------------------------------------------------------------

create or replace function public.prevent_client_ea_branch_stripe_customer_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.stripe_customer_id is distinct from new.stripe_customer_id
  then
    if coalesce(auth.role(), '') in ('authenticated', 'anon', 'public') then
      raise exception 'ea_branches.stripe_customer_id is server-managed'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT'
     and new.stripe_customer_id is not null
  then
    if coalesce(auth.role(), '') in ('authenticated', 'anon', 'public') then
      raise exception 'ea_branches.stripe_customer_id is server-managed'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_client_ea_branch_stripe_customer_mutation
  on public.ea_branches;

create trigger trg_prevent_client_ea_branch_stripe_customer_mutation
  before insert or update on public.ea_branches
  for each row
  execute function public.prevent_client_ea_branch_stripe_customer_mutation();

comment on function public.prevent_client_ea_branch_stripe_customer_mutation() is
  'Blocks anon/authenticated mutation of ea_branches.stripe_customer_id. service_role / bypass paths may set it.';

-- ---------------------------------------------------------------------------
-- 3) Clarify company Stripe Customer is NOT Day 1 authoritative
-- ---------------------------------------------------------------------------

comment on column public.ea_companies.stripe_customer_id is
  'RESERVED for FUTURE organisation-level Stripe billing. NOT authoritative for Day 1 branch Checkout/Portal. Day 1 Stripe Customer lives on ea_branches.stripe_customer_id. Do not treat as entitlement or branch Portal customer.';

comment on table public.ea_companies is
  'Estate agency company (organisation layer). Day 1 commercial billing unit is the branch (ea_branches) with per-branch Stripe Customer. Organisation-tier consolidated billing may later use ea_companies.stripe_customer_id.';
