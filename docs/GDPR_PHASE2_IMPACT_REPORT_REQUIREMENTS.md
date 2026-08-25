# Phase 2 — `generate_erasure_impact_report` Requirements

**Status:** Implemented in migration `20260718100000_gdpr_erasure_impact_report.sql` — apply manually to Development  
**Implementation:** [Phase 2 Implementation](./GDPR_PHASE2_IMPACT_REPORT_IMPLEMENTATION.md)  
**Related:** [Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md)

---

## Objective

Provide a **read-only**, **service-role-only** RPC (or admin API wrapping RPC) that discovers all data categories associated with a user and returns a structured impact report for human scope assessment — **without exposing unnecessary raw PII** in the report output.

**Must not mutate data.**

---

## Function signature (proposed)

```sql
-- DESIGN ONLY — not migrated
generate_erasure_impact_report(
  p_user_id uuid,
  p_erasure_request_id uuid default null
) returns jsonb
```

**Access:** `REVOKE ALL FROM PUBLIC, anon, authenticated`; grant service role only.

**Idempotency:** Read-only; safe to re-run.

---

## Input validation

| Check | Behaviour |
|-------|-----------|
| `p_user_id` exists in `auth.users` | Else return `{ ok: false, error: 'user_not_found' }` |
| Development safety (optional script mirror) | Refuse non-Development project in verification scripts only |
| Rate limiting | Admin endpoint only |

---

## Report structure (JSON)

```json
{
  "ok": true,
  "generated_at": "ISO8601",
  "subject_user_id": "uuid",
  "account": {
    "account_type": "homeowner|estate_agent|...",
    "email_verified": true,
    "profile_present": true
  },
  "counts": {
    "property_operational_identities_active": 0,
    "property_operational_identities_historic": 0,
    "property_members": 0,
    "counterparty_participants": 0,
    "delegates_as_delegate": 0,
    "delegates_as_inviter": 0,
    "ea_branch_memberships": 0,
    "ea_assignments": 0,
    "properties_created": 0,
    "chains_created": 0,
    "claim_metadata_as_originator": 0,
    "claim_metadata_as_claimant": 0,
    "claim_invitations_created": 0,
    "ea_branch_invitations_created": 0,
    "email_events_as_recipient": 0,
    "email_events_as_sender": 0,
    "delink_events_as_actor": 0,
    "lifecycle_confirmations": 0,
    "completion_events_as_actor": 0,
    "activities_on_user_properties": 0
  },
  "email_correlation": {
    "auth_email_hash_prefix": "first8ofHMAC",
    "invite_email_row_count": 0,
    "email_events_by_email_count": 0
  },
  "person_property_relationships": [
    {
      "property_id": 123,
      "roles": ["operational_homeowner"],
      "operational_state": "active",
      "shared_participant_count": 2,
      "other_active_homeowner": true,
      "ea_assigned": true,
      "address_erasure_eligibility": "retain_shared|sole_participant_redact|already_anonymised|manual_review"
    }
  ],
  "shared_transaction_flags": {
    "has_active_shared_transaction": true,
    "blocking_full_address_erasure_count": 1,
    "requires_partial_erasure": true
  },
  "sole_participant_properties": {
    "count": 0,
    "property_ids": []
  },
  "ea_organisation": {
    "companies_created_count": 0,
    "branch_memberships_count": 0,
    "is_last_member_of_branch": false,
    "is_last_member_of_company": false,
    "requires_org_admin_review": false
  },
  "invitations": {
    "pending_property_claim_invitations": 0,
    "pending_ea_branch_invitations": 0
  },
  "communications": {
    "email_events_total": 0,
    "templates_sent": ["homeowner-invitation", "lifecycle-dormancy-warning"]
  },
  "audit_references": {
    "delink_events": 0,
    "lifecycle_events_with_user_metadata": 0,
    "jsonb_user_ref_scan": "pending|clean|manual_review_required"
  },
  "analytics": {
    "snapshots_linked_via_source_property_id": 0,
    "anonymity_classification": "pseudonymous",
    "re_identification_risk": "high|medium|low",
    "retain_after_erasure_recommended": false,
    "risk_factors": ["source_property_id_present", "small_postcode_district"]
  },
  "external_processors": {
    "resend_action_required": true,
    "redis_purge_recommended": false,
    "stripe_action_required": false
  },
  "proposed_actions": [
    { "action": "NULL_USER_REF", "table": "property_delink_events", "estimated_rows": 3 },
    { "action": "REDACT_EMAIL", "table": "email_events", "estimated_rows": 12 },
    { "action": "RETAIN_LAWFUL", "table": "properties", "property_id": 123, "reason_code": "shared_active_transaction" },
    { "action": "AUTH_DELETE", "table": "auth.users", "estimated_rows": 1 }
  ],
  "warnings": [
    "active_shared_transaction",
    "analytics_not_verified_anonymous",
    "last_ea_branch_member"
  ],
  "execution_readiness": {
    "ready_for_auto_execution": false,
    "requires_manual_approval": true,
    "blocking_reasons": ["shared_active_transaction"]
  }
}
```

---

## Discovery requirements

### Direct user-linked rows

Scan all tables with `user_id`, `created_by_user_id`, `*_user_id` columns listed in [Data Inventory](./GDPR_DATA_INVENTORY.md).

### Email-correlated rows

Match normalised `auth.users.email` against:

- `property_claim_metadata.invite_email`
- `ea_branch_invitations.invite_email`
- `email_events.recipient_email`

Report **counts only** — do not echo raw emails in report JSON (optional: HMAC prefix for admin verification).

### Person–property relationships

For each property linked to user:

- Active operational identity role
- Counterparty/delegate/EA presence
- Lifecycle `operational_state`
- Count of other active participants
- Compute `address_erasure_eligibility` per [contextual model](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md#part-4--property-address-erasure-contextual-model)

### Shared transaction dependencies

Flag when:

- `buyer_connected` / `seller_connected` with other participants
- Active EA assignment for another branch member's workflow
- Chain has multiple properties with distinct operational homeowners

### Sole-participant properties

Properties where user is only active operational participant and no blocking EA/counterparty — eligible for address redaction.

### EA organisation relationships

- Branch memberships
- Companies created by user
- **Flag** `requires_org_admin_review` if last member — do not propose auto-delete org

### Invitations

Count pending claim and branch invitations created by or sent to user.

### Communications

Aggregate `email_events` by template — no recipient email in output.

### Audit / JSONB

- Count lifecycle/delink events with `actor_user_id`
- Sample scan `metadata`/`payload` jsonb for user UUID string presence — flag `manual_review_required` if unconstrained content found

### Analytics re-identification risk

For snapshots where `source_property_id` matches user's properties:

- Apply criteria from architecture doc
- Set `retain_after_erasure_recommended: false` until Phase 3 verification passes

### External processors

Boolean flags only — no API calls in read-only report.

---

## Output privacy rules

| Rule | Rationale |
|------|-----------|
| No raw email in report | Admin UI might log JSON |
| No full addresses | Use property_id + eligibility enum |
| No auth tokens | — |
| Counts + enums + IDs acceptable | Operational necessity for admin |

---

## Verification (Phase 2 delivery)

Development-only script:

```bash
npx tsx scripts/verify-erasure-impact-report.ts
```

- Create synthetic user with known fixture shape
- Run report
- Assert counts match expected categories
- Assert no raw email in JSON output
- Assert `execution_readiness.ready_for_auto_execution === false` for shared transaction fixture

**No destructive tests.**

---

## Explicit non-goals (Phase 2)

- No `execute_verified_erasure`
- No Auth delete
- No email redaction
- No RLS changes

---

## Approval gate

Phase 3 (destructive execution) authorised only after:

1. Phase 2 report implemented and verified on Development
2. Operational runbook dry-run with real report output reviewed by founder
3. Legal review of partial erasure/refusal templates

---

*Specification for Phase 2 implementation — not migrated.*
