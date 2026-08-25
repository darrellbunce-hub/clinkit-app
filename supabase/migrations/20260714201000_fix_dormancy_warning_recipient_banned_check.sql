-- Fix dormancy warning recipient resolution excluding all non-banned users.
--
-- Previous predicate coalesce(banned_until, infinity) <= now() was false for
-- normal users (banned_until IS NULL), so no recipients were ever returned.

create or replace function public.get_dormancy_warning_email_recipient(
  p_property_id bigint
)
returns table (
  property_id bigint,
  chain_id bigint,
  homeowner_user_id uuid,
  recipient_email text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    poi.property_id,
    p.chain_id,
    poi.homeowner_user_id,
    lower(trim(u.email)) as recipient_email
  from public.property_operational_identities poi
  join public.properties p
    on p.id = poi.property_id
  join public.property_lifecycle_states pls
    on pls.property_id = poi.property_id
  join auth.users u
    on u.id = poi.homeowner_user_id
  where poi.property_id = p_property_id
    and poi.status = 'active'
    and pls.operational_state = 'dormancy_warning'
    and pls.dormancy_warning_notified_at is null
    and u.email is not null
    and trim(u.email) <> ''
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
  limit 1;
$$;

revoke all on function public.get_dormancy_warning_email_recipient(bigint) from public;
grant execute on function public.get_dormancy_warning_email_recipient(bigint) to service_role;
