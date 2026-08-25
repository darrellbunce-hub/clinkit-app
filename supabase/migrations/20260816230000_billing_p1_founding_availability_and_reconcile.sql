-- Billing P1: founding availability RPC + exceptional reconcile audit event.
-- Development-first. Does not enable entitlement enforcement.
-- Idempotent / forward-safe.

-- ---------------------------------------------------------------------------
-- 1) Allow exceptional founding reconciliation audit events
-- ---------------------------------------------------------------------------

alter table public.ea_subscription_events
  drop constraint if exists ea_subscription_events_event_type_check;

alter table public.ea_subscription_events
  add constraint ea_subscription_events_event_type_check
  check (
    event_type in (
      'subscription_started',
      'payment_succeeded',
      'payment_failed',
      'cancellation_scheduled',
      'cancellation_reversed',
      'subscription_expired',
      'resubscribed',
      'entitlement_changed',
      'founding_slot_reserved',
      'founding_slot_confirmed',
      'founding_slot_released',
      'founding_reconcile_exception'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Authoritative founding availability (single counting algorithm)
-- ---------------------------------------------------------------------------
-- available = 20 - confirmed - active reserved (after releasing expired holds)
-- Public marketing may cache this; Checkout/webhook must never use a cache.

create or replace function public.get_ea_founding_availability()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirmed integer;
  v_reserved integer;
  v_available integer;
begin
  perform public._release_expired_ea_founding_reservations();

  select count(*)::integer
  into v_confirmed
  from public.ea_founding_slot_ledger
  where state = 'confirmed';

  select count(*)::integer
  into v_reserved
  from public.ea_founding_slot_ledger
  where state = 'reserved'
    and reservation_expires_at > now();

  v_confirmed := coalesce(v_confirmed, 0);
  v_reserved := coalesce(v_reserved, 0);
  v_available := greatest(20 - v_confirmed - v_reserved, 0);

  return jsonb_build_object(
    'ok', true,
    'limit', 20,
    'confirmed_count', v_confirmed,
    'reserved_count', v_reserved,
    'available_count', v_available,
    'cohort_secured', v_confirmed >= 20,
    'founding_offer_open', v_available > 0,
    'reservation_seconds', 1800
  );
end;
$$;

comment on function public.get_ea_founding_availability() is
  'Authoritative founding cohort availability. Releases expired reservations first. Public UI may cache; Checkout reservation path must call reserve_ea_founding_slot live.';

revoke all on function public.get_ea_founding_availability() from public;
revoke all on function public.get_ea_founding_availability() from anon;
revoke all on function public.get_ea_founding_availability() from authenticated;
grant execute on function public.get_ea_founding_availability() to service_role;
-- Authenticated read for Account UI (not a substitute for reserve).
grant execute on function public.get_ea_founding_availability() to authenticated;
