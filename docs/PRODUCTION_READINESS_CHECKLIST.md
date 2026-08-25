-- Phase 3a: Searching placeholder schema (stage-authoritative model)
--
-- Canonical placeholder:
-- stage = 'searching'
-- address IS NULL
-- postcode IS NULL

-- Allow addressless searching placeholders.
alter table public.properties
  alter column address drop not null;

alter table public.properties
  alter column postcode drop not null;

-- Backfill legacy addressless rows into the canonical searching state.
update public.properties
set
  stage = 'searching',
  is_searching = true
where
  address is null
  and postcode is null
  and stage is distinct from 'searching';

-- Clear the compatibility flag on all addressed properties.
update public.properties
set is_searching = false
where
  stage is distinct from 'searching'
  and (address is not null or postcode is not null);

-- Stage/address invariant.
-- Searching placeholders have no address or postcode.
-- Every other property must have both.
alter table public.properties
  add constraint properties_stage_address_invariant
  check (
    (
      stage = 'searching'
      and address is null
      and postcode is null
    )
    or
    (
      stage is distinct from 'searching'
      and address is not null
      and postcode is not null
    )
  );

-- At most one active searching placeholder per user per chain.
create unique index properties_one_searching_per_user_chain
  on public.properties (chain_id, created_by_user_id)
  where stage = 'searching';

comment on constraint properties_stage_address_invariant on public.properties is
  'Searching placeholders use stage searching with null address/postcode; all other stages require address and postcode.';