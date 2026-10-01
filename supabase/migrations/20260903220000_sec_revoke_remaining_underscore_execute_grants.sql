-- SEC: Revoke anon/authenticated EXECUTE on two remaining underscore internals.
--
-- Follow-up to 20260903214500_sec_revoke_internal_secdef_execute_grants.sql.
-- Investigation confirmed these are not user-facing RPCs:
--   - _access_code_lookup_candidates: called only from join_chain_property (SECURITY DEFINER)
--   - _enforce_ea_branch_owner_invariant: constraint-trigger only on ea_branch_members
--
-- ACL-only. Does not alter function bodies, SECURITY DEFINER, search_path, ownership,
-- RLS, tables, columns, or data.
--
-- Idempotent REVOKE + GRANT. Do not apply until explicitly authorised.

revoke all on function public._access_code_lookup_candidates(text) from public, anon, authenticated;
grant execute on function public._access_code_lookup_candidates(text) to service_role;

revoke all on function public._enforce_ea_branch_owner_invariant() from public, anon, authenticated;
grant execute on function public._enforce_ea_branch_owner_invariant() to service_role;
