# Phase 3B — Privacy Admin Operations UI

Internal Keynetic platform-admin tooling for operating GDPR Right to Erasure requests without Supabase SQL Editor or terminal scripts.

**Not in scope:** homeowner self-service deletion, public account deletion buttons, Production rollout, or weakening existing GDPR RPC permissions.

---

## Architecture discovered (pre-implementation audit)

| Area | Finding |
|------|---------|
| Homeowner auth | Supabase session + `profiles.account_type = 'homeowner'` |
| Estate agent auth | Separate login/signup + `account_type = 'estate_agent'` + branch membership in `ea_branch_members.role` |
| `profiles.role` | Legacy column; **not** used for routing or GDPR |
| EA branch admin | `ea_branch_members.role = 'branch_admin'` — branch-scoped only |
| Platform admin (before 3B) | **Did not exist** |
| Privileged GDPR RPCs | `service_role` only (migrations `20260718100000`–`20260718150000`) |
| Existing pattern | Route handlers + server-only service-role utilities; no browser service-role |

---

## Platform-admin security model

Migration: `supabase/migrations/20260718160000_platform_admin_authority.sql`

| Control | Implementation |
|---------|------------------|
| Allowlist storage | `platform_admins` table (`user_id` PK) |
| Default | Deny — RLS enabled, no authenticated policies |
| Read/write allowlist | `service_role` only |
| Runtime check | `is_platform_admin(uuid)` RPC (service role) |
| App check | `lib/auth/platformAdmin.ts` → `isPlatformAdminUserId()` |
| Dev bootstrap (optional) | `PLATFORM_ADMIN_USER_IDS` env comma-separated UUID override |
| Separation | Completely separate from homeowner, EA, and branch-admin roles |

### Route security

| Layer | Behaviour |
|-------|-----------|
| Middleware | `/admin/*` requires authenticated session + platform admin |
| Layout | `app/admin/privacy/layout.tsx` calls `getPlatformAdminSession()` → `notFound()` if absent |
| Server actions | Every action calls `requirePrivacyAdminContext()` independently |
| Service role | Only inside server actions / server queries — never imported in client components |

Non-admin users receive redirect (middleware) or `404` (layout), not partial access.

---

## Routes and pages

| Route | Purpose |
|-------|---------|
| `/admin/privacy` | Request list + create request form |
| `/admin/privacy/[requestId]` | Operational detail workspace |

UI uses existing Keynetic shell patterns (`LightShellHeader`, `PageHeaderBand`, card tokens).

---

## Server-side privileged operations

All mutations are Next.js **server actions** in `lib/privacyAdmin/actions.ts`:

```
Browser (authenticated platform admin)
  → server action
  → requirePrivacyAdminContext()
  → createServiceRoleSupabaseClient()
  → existing lib/gdpr/* RPC wrappers
  → revalidatePath(/admin/privacy...)
```

| Action | Backend |
|--------|---------|
| Create request | `create_gdpr_erasure_request` |
| Verify identity | `verify_gdpr_erasure_identity` |
| Generate impact assessment | `assess_gdpr_erasure_scope` |
| Approve plan | `approve_gdpr_erasure_request` |
| Reject | `reject_gdpr_erasure_request` |
| Execute database erasure | `execute_gdpr_erasure_request` |
| Prepare Auth deletion | `mark_gdpr_erasure_auth_deletion_eligible` |
| Delete Keynetic account | `completeGdprAuthDeletion()` |
| Mark processor complete | `update_gdpr_erasure_processor_action` |

No GET-triggered mutations. Destructive actions require explicit confirmation in the UI before calling server actions.

---

## Subject lookup

| Rule | Implementation |
|------|----------------|
| Input | Admin enters requester email in create form |
| Lookup | Server RPC `lookup_auth_user_id_by_exact_email` (exact match only) |
| Enumeration | Returns null when absent — generic message in UI |
| Persistence | Erasure request stores `subject_user_id` UUID only |
| Email in workflow tables | Not stored in GDPR request free-text columns |

---

## Operational workflow (privacy@keynetic.co.uk → admin case)

1. **Intake** — Privacy email received outside the app (manual process).
2. **Create request** — Platform admin uses exact-match email lookup → `create_gdpr_erasure_request` with `request_source = privacy_email`.
3. **Identity verification** — Admin explicitly confirms identity via **Mark identity as verified** (not automatic from email receipt).
4. **Impact assessment** — **Generate impact assessment** runs Phase 2/3 scope assessment and displays sanitised operational sections.
5. **Approval** — Admin reviews proposed plan grouped into automatic DB actions, manual review, external processors, Auth-last. Approval does **not** bypass fresh scope fingerprint at execution.
6. **Database execution** — Separate **Execute approved erasure** action with confirmation modal.
7. **Manual / processor tracking** — Outstanding `gdpr_erasure_actions` and `gdpr_erasure_processor_actions` shown; Resend/Vercel never auto-completed.
8. **Auth deletion last** — **Delete Keynetic account** enabled only when backend readiness flags allow; uses Admin API + `complete_gdpr_erasure_auth_deletion`.
9. **Completion** — Terminal states (`completed`, `rejected`, `failed`) are read-only in the UI.

---

## PII and logging

The admin UI and presentation layer:

- Do **not** render raw emails, full addresses, tokens, provider payloads, or Auth metadata.
- Sanitise impact report and audit `event_detail` to allowlisted structured keys.
- Do not log entered emails or impact report raw content in server actions.

Verification: `npx tsx scripts/verify-privacy-admin.ts`

---

## Development setup

1. Apply migration locally/on Development (do **not** apply to Production in this phase):

   ```
   supabase/migrations/20260718160000_platform_admin_authority.sql
   ```

2. Grant platform admin to your operator account:

   ```sql
   insert into public.platform_admins (user_id, grant_reason_code)
   values ('<your-auth-user-uuid>', 'manual_bootstrap');
   ```

   Or set `PLATFORM_ADMIN_USER_IDS=<uuid>` in `.env.local` for Development bootstrap.

3. Sign in as that user and open `/admin/privacy`.

---

## Verification and regression

```bash
npx tsx scripts/verify-privacy-admin.ts
npx tsx scripts/verify-gdpr-erasure-execution.ts
npx tsx scripts/verify-gdpr-erasure-impact-report.ts
npx tsx scripts/verify-property-lifecycle.ts
npx tsx scripts/verify-property-lifecycle-automation.ts
npx tsx scripts/verify-lifecycle-dormancy-warning-email.ts
npx tsx scripts/verify-lifecycle-still-active-confirmation.ts
npx tsx scripts/verify-lifecycle-dormancy-e2e.ts
npm run build
```

---

## Remaining launch blockers (Production)

- Apply `20260718160000` to Production with audited platform-admin grants
- Formal privacy/legal sign-off on operational workflow documentation
- Production operator runbook and on-call access controls
- Optional: replace env bootstrap with audited admin provisioning UI
- Phase 4+ items intentionally not started here
