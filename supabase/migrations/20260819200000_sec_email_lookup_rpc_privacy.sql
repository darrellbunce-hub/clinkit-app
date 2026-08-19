-- SEC: Narrow get_user_email_by_id privileges.
--
-- Root cause: EXECUTE was granted to `authenticated`, so any signed-in user who
-- obtained another user's UUID could call the RPC and read that user's auth email.
--
-- Intended model:
-- - Authenticated clients MUST NOT call get_user_email_by_id directly.
-- - Emails for team directory remain available only via authorised SECURITY DEFINER
--   workflows (e.g. get_ea_branch_team_directory), which already gate on
--   can_access_ea_branch_team / branch membership.
-- - service_role retains EXECUTE for trusted server-side operations only.
--
-- Do not expose SUPABASE_SERVICE_ROLE_KEY to clients.

revoke all on function public.get_user_email_by_id(uuid) from public;
revoke all on function public.get_user_email_by_id(uuid) from anon;
revoke all on function public.get_user_email_by_id(uuid) from authenticated;

grant execute on function public.get_user_email_by_id(uuid) to service_role;

comment on function public.get_user_email_by_id(uuid) is
  'Internal auth.users email lookup for SECURITY DEFINER workflows (e.g. branch team directory). Not callable by authenticated/anon clients. EXECUTE granted to service_role only.';
