# Privacy Admin MFA / AAL2 Security

Security-critical documentation for Phase 3B Privacy Admin hardening.

**Related:** [Privacy Admin Operations](./GDPR_PHASE3B_PRIVACY_ADMIN.md) · [GDPR Launch Checklist](./GDPR_LAUNCH_CHECKLIST.md)

---

## Threat model

| Threat | Mitigation |
|--------|------------|
| Stolen platform-admin password (AAL1 session) | Mandatory TOTP + AAL2 for all privileged admin operations |
| Direct Server Action / RPC invocation | Independent re-authorisation on every action; GDPR RPCs remain `service_role`-only |
| Email enumeration via subject lookup | Exact-match lookup is server-side only, rate-limited, requires AAL2, returns generic UI messages |
| Unauthorised role escalation (EA branch admin) | Separate `platform_admins` allowlist; not derived from `profiles.role` or EA roles |
| Session downgrade after page load | Live `evaluatePlatformAdminAccess()` on every server action and read query |
| Open redirect after MFA | `sanitizeAdminNextPath()` allowlists `/admin/privacy` and `/admin/mfa` prefixes only |
| Information disclosure on `/admin/*` | Non-members receive `404`; no subject UUIDs or request metadata leaked |

MFA is **mandatory for platform-admin access only**. Homeowners and estate agents are unaffected.

---

## Security boundary (before → after)

| Layer (before MFA hardening) | Gap | After |
|------------------------------|-----|-------|
| Middleware `/admin/*` | Platform admin membership only | Membership + MFA route orchestration |
| Privacy layout | Membership only | Live AAL2 check |
| Server actions | Platform admin + service role | Platform admin + **live AAL2** + service role |
| Read queries | Service role without AAL2 re-check | `assertPrivacyAdminContextForRead()` |
| Subject lookup | Service role behind admin session | Same + **AAL2** + rate limit |

---

## Platform-admin authority

Unchanged from Phase 3B:

- `platform_admins` table (deny-by-default RLS)
- `is_platform_admin(uuid)` — service role only
- Optional Development bootstrap: `PLATFORM_ADMIN_USER_IDS`

**Not authoritative:** `profiles.role`, `profiles.account_type`, EA branch admin, email domain.

---

## MFA architecture

Uses **Supabase Auth MFA APIs** (TOTP). Keynetic does not implement TOTP cryptography or store secrets in application tables.

| Component | Path |
|-----------|------|
| Access resolution (pure) | `lib/auth/platformAdminAccessCore.ts` |
| Live evaluation | `lib/auth/platformAdminAccess.ts` |
| MFA server actions | `lib/auth/platformAdminMfaActions.ts` (status, unenroll) |
| MFA browser client | `lib/auth/platformAdminMfaClient.ts` |
| Safe redirects | `lib/auth/safeAdminRedirect.ts` |
| Enrol UI | `/admin/mfa/enroll` |
| Challenge UI | `/admin/mfa/challenge` |
| Status UI | `/admin/mfa` |

### AAL1 vs AAL2

| Level | Meaning | Privacy Admin |
|-------|---------|---------------|
| **AAL1** | Password (or equivalent) authenticated | MFA enrol/challenge pages only |
| **AAL2** | Password + verified TOTP factor in current session | All `/admin/privacy` reads and mutations |

Supabase signals: `auth.mfa.getAuthenticatorAssuranceLevel()`.

---

## Enrolment flow

1. Platform admin signs in (AAL1).
2. Middleware/layout detect no verified TOTP → redirect to `/admin/mfa/enroll`.
3. Browser client `startPlatformAdminMfaEnrollClient()`:
   - Removes abandoned **unverified** factors from `listFactors().all`
   - Calls `auth.mfa.enroll({ factorType: 'totp' })` in the user's session
4. UI displays QR SVG + manual secret (never logged).
5. Admin enters 6-digit code → `verifyPlatformAdminMfaEnrollClient()` (challenge + verify).
6. Browser session reaches AAL2 → redirect to `/admin/privacy` (or sanitised `next`).

MFA enrol/challenge/verify use the **browser Supabase client** so the live session and AAL2 cookie updates persist. Route guards remain server-side.

---

## Returning challenge flow

1. Platform admin signs in with existing verified TOTP (AAL1).
2. Access to `/admin/privacy` blocked → redirect `/admin/mfa/challenge?next=...`.
3. Admin enters authenticator code → `verifyPlatformAdminMfaChallengeClient()`.
4. Session reaches AAL2 → continue to sanitised destination.

---

## Route enforcement

| Route | Requirement |
|-------|-------------|
| `/admin/mfa/enroll` | Platform admin membership |
| `/admin/mfa/challenge` | Platform admin + verified factor + AAL1 |
| `/admin/mfa` | Platform admin + AAL2 |
| `/admin/privacy/*` | Platform admin + AAL2 |

Middleware (`middleware.ts` + `routeGuards.ts`) orchestrates redirects. Layouts call `notFound()` for non-members. **Server actions re-check independently.**

---

## Server Action enforcement

All actions in `lib/privacyAdmin/actions.ts` call `requirePrivacyAdminContext()` which requires:

1. Authenticated user  
2. `platform_admins` membership  
3. Live AAL2 session  

Failure returns `{ ok: false, error: 'mfa_required' }` with **no mutation**.

Read queries call `assertPrivacyAdminContextForRead()` with the same live check.

---

## Exact-email lookup protection

| Control | Status |
|---------|--------|
| RPC `lookup_auth_user_id_by_exact_email` | `service_role` execute only |
| Application path | `requirePrivacyAdminContext()` (AAL2) before lookup |
| Rate limiting | `consumeRateLimit('privacy-admin-subject-lookup', adminUserId, 20/min)` with `failOpen: false` |
| Enumeration | Generic UI when no match; no public endpoint |

---

## Service-role boundary

Service role is used **only** inside server-side Privacy Admin code after human AAL2 verification. Never imported in client components.

---

## GDPR / platform RPC grant matrix

| RPC | public | anon | authenticated | service_role | security definer | Intended caller |
|-----|--------|------|---------------|--------------|------------------|-----------------|
| `generate_erasure_impact_report` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server (post-AAL2) |
| `create_gdpr_erasure_request` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `verify_gdpr_erasure_identity` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `assess_gdpr_erasure_scope` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `approve_gdpr_erasure_request` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `reject_gdpr_erasure_request` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `execute_gdpr_erasure_request` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `mark_gdpr_erasure_auth_deletion_eligible` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `complete_gdpr_erasure_auth_deletion` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `get_gdpr_erasure_request_status` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server reads |
| `update_gdpr_erasure_processor_action` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin server actions |
| `is_platform_admin` | ✗ | ✗ | ✗ | ✓ | ✓ | Server-side admin checks |
| `lookup_auth_user_id_by_exact_email` | ✗ | ✗ | ✗ | ✓ | ✓ | Privacy Admin create-request (AAL2) |
| `_gdpr_shared_transaction_safety_block` | ✗ | ✗ | ✗ | ✓ | ✓ | Verification / internal (not browser) |
| `_gdpr_redact_sole_participant_property_address` | ✗ | ✗ | ✗ | ✓ | ✓ | Executor / verification |

Grants verified by `scripts/verify-privacy-admin-security.ts`.

---

## Recovery procedure

| Scenario | Procedure |
|----------|-----------|
| Lost authenticator | Operational recovery only: verify identity out-of-band with engineering/legal leadership; Supabase dashboard or controlled re-provisioning; **no Production UI bypass** |
| Remove factor (admin UI) | Requires AAL2; removing the only verified factor blocks privileged access until re-enrolment |
| Abandoned enrolment | Unverified factors cleaned before new enrolment |

There is **no** “disable MFA and continue” self-service bypass.

---

## Production provisioning requirements

1. `platform_admins` row for each operator (manual, audited)
2. Supabase project: TOTP enabled, SMS MFA disabled, enhanced AAL1 session limits enabled
3. Each operator completes `/admin/mfa/enroll` before first privileged use
4. `PLATFORM_ADMIN_USER_IDS` env bootstrap **not** used in Production
5. Upstash Redis available for subject-lookup rate limiting (or accept documented fail-closed dependency)

---

## Verification

```bash
npx tsx scripts/verify-privacy-admin-security.ts
npx tsx scripts/verify-privacy-admin.ts
```

---

## Manual browser tests still required

1. Sign in as `admin@keynetic.co.uk` → enrol TOTP → reach `/admin/privacy`
2. Sign out/in → challenge screen → AAL2 → privacy admin works
3. Homeowner account → `/admin/privacy` returns 404
4. EA account → `/admin/privacy` returns 404
5. Attempt open redirect `?next=https://evil.example` after MFA
6. Leave admin tab idle past AAL1 limit → next action shows MFA required
7. Remove authenticator on `/admin/mfa` → re-enrol required

---

## Enrolling admin@keynetic.co.uk (Microsoft / Google Authenticator)

1. Sign in at `/login` with `admin@keynetic.co.uk`.
2. Navigate to `/admin/privacy` (redirects to `/admin/mfa/enroll`).
3. Scan QR code with Microsoft Authenticator or Google Authenticator (or enter manual key).
4. Enter the 6-digit code → verify.
5. Confirm landing on `/admin/privacy` and MFA status shows AAL2 at `/admin/mfa`.
