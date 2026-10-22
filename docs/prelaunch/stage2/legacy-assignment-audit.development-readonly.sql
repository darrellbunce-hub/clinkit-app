-- READ-ONLY AUDIT PLAN — NOT RUN. Development project only; never Production.
-- Not a migration: never copy into supabase/migrations.
--
-- Purpose (Stage 2 README, task E): find active Estate Agent assignments
-- that would not be created under the seller-side authority rules
-- (20261005110000, 20261005120000; Business Rules 4.7, 7.8, 25.27) — for
-- example an assignment made by a buyer, on a row with no seller side, or by
-- a branch that is no longer entitled. Every active assignment is checked
-- against the current rules, so the result does not depend on when
-- 20261005110000 reached Development; created_at is reported for context.
--
-- How to run (operator, after approval): open the Development SQL editor,
-- run the whole file. The transaction is READ ONLY and ends in ROLLBACK.
-- Output is ids, codes, booleans and counts only: no names, emails,
-- addresses, phone numbers or raw user ids.
--
-- Tables and columns read:
--   property_ea_assignments      id, property_id, branch_id, status,
--                                assigned_by_user_id, created_at
--   properties                   id, chain_id, relationship_type
--   property_operational_identities  property_id, homeowner_user_id, status
--   property_counterparty_participants  property_id, user_id,
--                                counterparty_role, status
--   property_claim_metadata      property_id, origin_type, claim_status
--   property_claim_invitations   id, property_id, created_by_user_id,
--                                invitation_revoked_at, invitation_used_at,
--                                invitation_expires_at
--   ea_branch_members            branch_id, user_id
--   ea_branch_subscriptions      branch_id (via is_ea_branch_commercially_entitled)
-- Functions read (stable, no writes): _property_seller_side_user_id(bigint),
-- is_ea_branch_commercially_entitled(uuid), is_smoke_test_ea_branch(uuid).

begin transaction read only;

-- A0. Context: active assignments by row type and age.
-- Expected: one row per relationship_type ('sale', 'purchase').
select
  p.relationship_type,
  count(*) as active_assignments,
  min(pea.created_at) as oldest,
  max(pea.created_at) as newest
from public.property_ea_assignments pea
inner join public.properties p on p.id = pea.property_id
where pea.status = 'active'
group by p.relationship_type
order by p.relationship_type;

-- A1. Active assignment on a row that is neither a sale nor a purchase.
-- Expected: 0 rows.
select pea.id as assignment_id, pea.property_id, pea.branch_id, p.chain_id,
       p.relationship_type, pea.created_at
from public.property_ea_assignments pea
inner join public.properties p on p.id = pea.property_id
where pea.status = 'active'
  and (p.relationship_type is null or p.relationship_type not in ('sale', 'purchase'))
order by pea.created_at;

-- A2. Active assignment on a row with no seller side today.
-- Expected: only 'estate_agent_unclaimed' rows (awaiting connection, 25.31).
-- Any 'no_seller_side' row needs review.
select pea.id as assignment_id, pea.property_id, pea.branch_id, p.chain_id,
       p.relationship_type, pea.created_at,
       case
         when pcm.origin_type = 'estate_agent' and pcm.claim_status <> 'claimed'
           then 'estate_agent_unclaimed'
         else 'no_seller_side'
       end as classification
from public.property_ea_assignments pea
inner join public.properties p on p.id = pea.property_id
left join public.property_claim_metadata pcm on pcm.property_id = pea.property_id
where pea.status = 'active'
  and public._property_seller_side_user_id(pea.property_id) is null
order by classification, pea.created_at;

-- A3. Active assignment made by someone who is neither the row's seller side
-- today nor a member of the assigned branch (for example a buyer, before
-- seller-side authority).
-- Expected: 0 rows. 'seller_side_changed' means the appointer was the seller
-- side once (e.g. a different seller); 'never_seller_side' needs review.
select pea.id as assignment_id, pea.property_id, pea.branch_id, p.chain_id,
       p.relationship_type, pea.created_at,
       case
         when exists (
           select 1 from public.property_operational_identities poi
           where poi.property_id = pea.property_id
             and poi.homeowner_user_id = pea.assigned_by_user_id
         ) or exists (
           select 1 from public.property_counterparty_participants cp
           where cp.property_id = pea.property_id
             and cp.user_id = pea.assigned_by_user_id
             and cp.counterparty_role = 'seller'
         ) then 'seller_side_changed'
         else 'never_seller_side'
       end as classification,
       exists (
         select 1 from public.property_counterparty_participants cp
         where cp.property_id = pea.property_id
           and cp.user_id = pea.assigned_by_user_id
           and cp.counterparty_role = 'buyer'
       ) as appointer_was_buyer
from public.property_ea_assignments pea
inner join public.properties p on p.id = pea.property_id
where pea.status = 'active'
  and pea.assigned_by_user_id is distinct from public._property_seller_side_user_id(pea.property_id)
  and not exists (
    select 1 from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = pea.assigned_by_user_id
  )
order by classification, pea.created_at;

-- A4. Active assignment on a purchase row without exactly one active
-- counterparty seller (seller side is ambiguous or missing).
-- Expected: 0 rows.
select pea.id as assignment_id, pea.property_id, pea.branch_id, p.chain_id,
       pea.created_at,
       (select count(*) from public.property_counterparty_participants cp
        where cp.property_id = pea.property_id
          and cp.counterparty_role = 'seller'
          and cp.status = 'active') as active_sellers
from public.property_ea_assignments pea
inner join public.properties p on p.id = pea.property_id
where pea.status = 'active'
  and p.relationship_type = 'purchase'
  and (select count(*) from public.property_counterparty_participants cp
       where cp.property_id = pea.property_id
         and cp.counterparty_role = 'seller'
         and cp.status = 'active') <> 1
order by pea.created_at;

-- A5. More than one active assignment per property.
-- Expected: 0 rows (property_ea_assignments_one_active_per_property_idx).
select pea.property_id, count(*) as active_assignments
from public.property_ea_assignments pea
where pea.status = 'active'
group by pea.property_id
having count(*) > 1;

-- A6. Entitlement of every branch holding active assignments (B5).
-- Expected: entitled branches, plus any smoke-test fixture branches. Rows
-- with entitled = false and has_subscription_row = true are what
-- reconcile_ea_branch_entitlement_access() would revoke; rows with
-- has_subscription_row = false are the "no subscription history" decision.
select pea.branch_id,
       count(*) as active_assignments,
       public.is_ea_branch_commercially_entitled(pea.branch_id) as entitled,
       exists (select 1 from public.ea_branch_subscriptions s where s.branch_id = pea.branch_id) as has_subscription_row,
       public.is_smoke_test_ea_branch(pea.branch_id) as smoke_test_fixture
from public.property_ea_assignments pea
where pea.status = 'active'
group by pea.branch_id
order by entitled, has_subscription_row, pea.branch_id;

-- A7. Open, unexpired claim invitations not backed by the property's current
-- assigned branch (no active assignment, or issued by someone who is not a
-- member of the assigned branch).
-- Expected: 0 rows.
select pci.id as invitation_id, pci.property_id,
       pea.branch_id as assigned_branch_id,
       (pea.id is null) as no_active_assignment
from public.property_claim_invitations pci
left join public.property_ea_assignments pea
  on pea.property_id = pci.property_id
 and pea.status = 'active'
where pci.invitation_revoked_at is null
  and pci.invitation_used_at is null
  and pci.invitation_expires_at > now()
  and (
    pea.id is null
    or not exists (
      select 1 from public.ea_branch_members bm
      where bm.branch_id = pea.branch_id
        and bm.user_id = pci.created_by_user_id
    )
  )
order by pci.property_id;

rollback;
