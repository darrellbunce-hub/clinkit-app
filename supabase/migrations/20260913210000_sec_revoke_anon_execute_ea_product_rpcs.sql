-- SEC: Revoke anon EXECUTE from three authenticated product RPCs.
--
-- Context:
--   These SECURITY DEFINER RPCs are user-facing product surfaces called only from
--   authenticated browser/app sessions (join-chain cleanup; EA originate/join).
--   Function bodies already reject auth.uid() IS NULL with not_authenticated.
--   Anon EXECUTE is unnecessary grant surface and is revoked here.
--
-- Scope:
--   ACL-only. Does not alter function bodies, SECURITY DEFINER, search_path,
--   ownership, RLS, tables, columns, or data.
--
-- Keeps:
--   EXECUTE for authenticated and service_role.
--
-- Idempotent:
--   REVOKE from anon/public is safe if already revoked.
--   GRANT EXECUTE to authenticated/service_role is safe if already granted.

revoke execute on function public.cleanup_abandoned_onboarding_chain(bigint)
  from public, anon;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint)
  to authenticated;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint)
  to service_role;

revoke execute on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) from public, anon;
grant execute on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) to authenticated;
grant execute on function public.create_ea_operational_property(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) to service_role;

revoke execute on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) from public, anon;
grant execute on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) to authenticated;
grant execute on function public.join_ea_operational_chain(
  text, text, text, text, uuid, boolean, text, text, boolean
) to service_role;
