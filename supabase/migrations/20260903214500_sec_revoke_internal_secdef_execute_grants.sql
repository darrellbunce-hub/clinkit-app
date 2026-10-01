-- SEC: Revoke accidental anon/authenticated EXECUTE on internal / worker SECURITY DEFINER RPCs.
--
-- Context:
--   Supabase default privileges grant EXECUTE on new functions to anon, authenticated,
--   and service_role. Earlier migrations often only REVOKE FROM public, which leaves
--   explicit anon/authenticated EXECUTE intact. That exposed GDPR helpers, lifecycle
--   workers, operational-summary workers, and underscore core helpers via PostgREST.
--
-- Scope:
--   ACL-only. Does not alter function bodies, SECURITY DEFINER, search_path, ownership,
--   RLS, tables, columns, or data.
--
-- Idempotent:
--   REVOKE ALL … FROM public, anon, authenticated is safe if already revoked.
--   GRANT EXECUTE … TO service_role is safe if already granted.
--
-- Apply only when explicitly authorised. Do not apply from this investigation alone.

-- ---------------------------------------------------------------------------
-- GDPR implementation helpers (and non-DEFINER helpers used only by service path)
-- ---------------------------------------------------------------------------
revoke all on function public._gdpr_erasure_audit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public._gdpr_erasure_audit(uuid, text, jsonb) to service_role;

revoke all on function public._gdpr_execute_erasure_action(uuid, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_execute_erasure_action(uuid, uuid) to service_role;

revoke all on function public._gdpr_prepare_subject_for_auth_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_prepare_subject_for_auth_deletion(uuid, uuid) to service_role;

revoke all on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) to service_role;

revoke all on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) to service_role;

revoke all on function public._gdpr_shared_transaction_safety_block(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public._gdpr_shared_transaction_safety_block(uuid, bigint, text) to service_role;

revoke all on function public._gdpr_action_status_on_approval(text) from public, anon, authenticated;
grant execute on function public._gdpr_action_status_on_approval(text) to service_role;

revoke all on function public._gdpr_compute_scope_fingerprint(jsonb) from public, anon, authenticated;
grant execute on function public._gdpr_compute_scope_fingerprint(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Property lifecycle / dormancy worker RPCs
-- ---------------------------------------------------------------------------
revoke all on function public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.execute_property_lifecycle_action(bigint, text, text, text, uuid, jsonb) to service_role;

revoke all on function public.execute_property_lifecycle_archive(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.execute_property_lifecycle_archive(bigint, text, jsonb) to service_role;

revoke all on function public.execute_property_lifecycle_release(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.execute_property_lifecycle_release(bigint, text, jsonb) to service_role;

revoke all on function public.execute_property_lifecycle_anonymise(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.execute_property_lifecycle_anonymise(bigint, text, jsonb) to service_role;

revoke all on function public.execute_enter_dormancy_warning(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.execute_enter_dormancy_warning(bigint, text, jsonb) to service_role;

revoke all on function public.list_property_lifecycle_worker_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_property_lifecycle_worker_candidates(integer) to service_role;

revoke all on function public.try_acquire_property_lifecycle_lease(bigint, integer) from public, anon, authenticated;
grant execute on function public.try_acquire_property_lifecycle_lease(bigint, integer) to service_role;

revoke all on function public.release_property_lifecycle_lease(bigint) from public, anon, authenticated;
grant execute on function public.release_property_lifecycle_lease(bigint) to service_role;

revoke all on function public.record_property_lifecycle_transition_worker(bigint, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_property_lifecycle_transition_worker(bigint, text, text, text, text, jsonb) to service_role;

revoke all on function public.persist_property_analytics_snapshot(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.persist_property_analytics_snapshot(bigint, jsonb, text) to service_role;

revoke all on function public.list_dormancy_warning_notification_targets(bigint) from public, anon, authenticated;
grant execute on function public.list_dormancy_warning_notification_targets(bigint) to service_role;

revoke all on function public.get_dormancy_warning_email_recipient(bigint) from public, anon, authenticated;
grant execute on function public.get_dormancy_warning_email_recipient(bigint) to service_role;

revoke all on function public.try_claim_dormancy_warning_notification(bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.try_claim_dormancy_warning_notification(bigint, uuid, integer) to service_role;

revoke all on function public.mark_dormancy_warning_notification_sent(bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_dormancy_warning_notification_sent(bigint, uuid, uuid) to service_role;

revoke all on function public.release_dormancy_warning_notification_claim(bigint) from public, anon, authenticated;
grant execute on function public.release_dormancy_warning_notification_claim(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Operational summary / chain intelligence worker RPCs
-- ---------------------------------------------------------------------------
revoke all on function public.upsert_operational_summaries_service(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_operational_summaries_service(jsonb, jsonb) to service_role;

revoke all on function public.list_chain_intelligence_refresh_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_chain_intelligence_refresh_candidates(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Internal underscore / core helpers (invitation, identity, delink, EA assign)
-- ---------------------------------------------------------------------------
revoke all on function public._create_property_claim_invitation(bigint, uuid) from public, anon, authenticated;
grant execute on function public._create_property_claim_invitation(bigint, uuid) to service_role;

revoke all on function public._revoke_open_property_claim_invitations(bigint) from public, anon, authenticated;
grant execute on function public._revoke_open_property_claim_invitations(bigint) to service_role;

revoke all on function public._revoke_expired_ea_branch_invitations(uuid, text) from public, anon, authenticated;
grant execute on function public._revoke_expired_ea_branch_invitations(uuid, text) to service_role;

revoke all on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) to service_role;

revoke all on function public._grant_counterparty_participation_core(bigint, uuid) from public, anon, authenticated;
grant execute on function public._grant_counterparty_participation_core(bigint, uuid) to service_role;

revoke all on function public._upsert_property_membership_row(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public._upsert_property_membership_row(bigint, uuid, text) to service_role;

revoke all on function public._sync_property_claim_on_homeowner_grant(bigint, uuid) from public, anon, authenticated;
grant execute on function public._sync_property_claim_on_homeowner_grant(bigint, uuid) to service_role;

revoke all on function public._insert_participation_delink_activity(bigint, text, text) from public, anon, authenticated;
grant execute on function public._insert_participation_delink_activity(bigint, text, text) to service_role;

revoke all on function public._notify_chain_participants_of_delink(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public._notify_chain_participants_of_delink(bigint, bigint, text) to service_role;

-- Both live overloads of _execute_participation_delink
revoke all on function public._execute_participation_delink(bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public._execute_participation_delink(bigint, text, uuid, text) to service_role;

revoke all on function public._execute_participation_delink(bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public._execute_participation_delink(bigint, text, text, uuid) to service_role;

revoke all on function public._ea_assign_originated_property(bigint, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public._ea_assign_originated_property(bigint, uuid, boolean, text, text, text) to service_role;

revoke all on function public._require_verified_email_for_transaction() from public, anon, authenticated;
grant execute on function public._require_verified_email_for_transaction() to service_role;

-- Trigger helpers: EXECUTE is not required for trigger fire; revoke PostgREST surface
revoke all on function public._trg_touch_operational_activity_from_activity() from public, anon, authenticated;
grant execute on function public._trg_touch_operational_activity_from_activity() to service_role;

revoke all on function public._trg_touch_operational_activity_from_claim() from public, anon, authenticated;
grant execute on function public._trg_touch_operational_activity_from_claim() to service_role;

revoke all on function public._trg_touch_operational_activity_from_counterparty() from public, anon, authenticated;
grant execute on function public._trg_touch_operational_activity_from_counterparty() to service_role;

revoke all on function public._trg_touch_operational_activity_from_property() from public, anon, authenticated;
grant execute on function public._trg_touch_operational_activity_from_property() to service_role;
