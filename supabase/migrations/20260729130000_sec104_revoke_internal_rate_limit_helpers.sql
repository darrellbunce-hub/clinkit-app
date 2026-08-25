-- SEC-104 follow-up: revoke client EXECUTE on internal rate-limit helpers.
--
-- Root cause: CREATE FUNCTION grants EXECUTE to PUBLIC by default, and Supabase
-- environments typically also grant EXECUTE to anon/authenticated via default
-- privileges. Migration 20260729120000 only REVOKE'd FROM PUBLIC, which left
-- anon/authenticated able to call helpers via PostgREST.
--
-- Internal SECURITY DEFINER workflow RPCs continue to call these helpers as the
-- function owner; client REVOKE does not break that path.

revoke all on function public._rate_limit_window_start(integer) from public;
revoke all on function public._rate_limit_window_start(integer) from anon;
revoke all on function public._rate_limit_window_start(integer) from authenticated;

revoke all on function public._rate_limit_cleanup_subject(text, text, integer) from public;
revoke all on function public._rate_limit_cleanup_subject(text, text, integer) from anon;
revoke all on function public._rate_limit_cleanup_subject(text, text, integer) from authenticated;

revoke all on function public._rate_limit_is_blocked(text, text, integer, integer) from public;
revoke all on function public._rate_limit_is_blocked(text, text, integer, integer) from anon;
revoke all on function public._rate_limit_is_blocked(text, text, integer, integer) from authenticated;

revoke all on function public._rate_limit_record_attempt(text, text, integer) from public;
revoke all on function public._rate_limit_record_attempt(text, text, integer) from anon;
revoke all on function public._rate_limit_record_attempt(text, text, integer) from authenticated;

revoke all on function public._rate_limit_try_consume(text, text, integer, integer) from public;
revoke all on function public._rate_limit_try_consume(text, text, integer, integer) from anon;
revoke all on function public._rate_limit_try_consume(text, text, integer, integer) from authenticated;
