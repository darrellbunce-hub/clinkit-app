-- Phase 4c: structured completion date amendment audit fields

alter table public.chain_completion_events
  add column if not exists reason_code text null;

alter table public.chain_completion_events
  drop constraint if exists chain_completion_events_reason_code_check;

alter table public.chain_completion_events
  add constraint chain_completion_events_reason_code_check
  check (
    reason_code is null
    or reason_code in (
      'solicitor_revised_date',
      'chain_dependency_adjustment',
      'mortgage_or_lender_timing',
      'removals_or_logistics_timing',
      'developer_or_new_build_timing',
      'incorrect_date_entered',
      'administrative_correction'
    )
  );

comment on column public.chain_completion_events.reason_code is
  'Structured amendment reason code for completion_date_changed events.';
