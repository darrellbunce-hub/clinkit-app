-- Phase 3a: Searching placeholder schema (stage-authoritative model)
--
-- Canonical placeholder: stage = 'searching', address IS NULL, postcode IS NULL
-- is_searching is not authoritative; optional compatibility mirror on write only.

-- Allow addressless searching placeholders.
alter table public.properties
  alter column address drop not null;

alter table public.properties
  alter column postcode drop not null;

-- Backfill: legacy is_searching rows without address become stage searching.
update public.properties
set
  stage = 'searching',
  is_searching = true
where
  is_searching = true
  and address is null
  and postcode is null
  and stage is distinct from 'searching';

-- Backfill: addressless rows not yet marked searching.
update public.properties
set
  stage = 'searching',
  is_searching = true
where
  address is null
  and postcode is null
  and stage is distinct from 'searching';

-- Clear compatibility flag on addressed rows.
update public.properties
set is_searching = false
where
  is_searching = true
  and (address is not null or postcode is not null);

-- Stage/address invariant (stage-authoritative placeholder rules).
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

-- At most one active searching placeholder per participant per chain.
-- Re-search after conversion: reset the same row to stage searching, or insert
-- a new placeholder once the prior row is no longer stage = searching.
create unique index properties_one_searching_per_user_chain
  on public.properties (chain_id, created_by_user_id)
  where stage = 'searching';

comment on constraint properties_stage_address_invariant on public.properties is
  'Searching placeholders use stage searching with null address/postcode; all other stages require address and postcode.';
