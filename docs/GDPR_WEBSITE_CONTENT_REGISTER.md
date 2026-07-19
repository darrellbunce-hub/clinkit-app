# GDPR Website & Content Review Register — Keynetic

**Version:** Phase 1 register — cross-referenced with founder decisions  
**Related:** [Launch Content Audit](./LAUNCH_CONTENT_AUDIT.md) · [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Launch Checklist](./GDPR_LAUNCH_CHECKLIST.md)

> **Note:** Founder review (FD-001–FD-037) and [Stage 2 consolidation](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md) supersede conflicting audit recommendations. **Stage 3.5** Chain Intelligence redesign required before confidence copy.

---

## Purpose

Track pages, components, and templates requiring privacy/GDPR content review **after** system behaviour is finalised. Do not rewrite in Phase 1.

**Privacy contact (proposed):** privacy@keynetic.co.uk

---

## Register

| Area | Path / component | Current issue | Privacy/GDPR implication | Product accuracy issue | Required future change |
|------|------------------|---------------|--------------------------|------------------------|------------------------|
| Homepage | `/` | Privacy links may be missing | Lawful basis, contact | — | Footer links to Privacy/Terms |
| Homeowner sign-up | `/login`, signup flows | No privacy notice link at collection | Art. 13 transparency | — | Sign-up privacy snippet + link |
| Estate agent sign-up | `/estate-agents/signup` | Same | EA client data responsibilities | — | EA-specific privacy wording |
| Login | `/login` | Minimal privacy context | — | — | Link to Privacy Policy |
| Start Move | `app/start-move/page.tsx` | Address collection | Purpose limitation, retention | — | Explain address use; no PII logging (fixed Phase 1) |
| Join Chain | `app/join-chain/page.tsx` | Address + access code | Same | — | Explain shared transaction visibility |
| Claim Property | Claim flows | Invite email/name | Third-party invite transparency | — | Invite recipient rights summary |
| Property workspace | `app/property/[propertyId]/page.tsx` | Participant visibility | Address privacy between participants | — | Confirm RLS behaviour described accurately |
| Chain view | `app/chain/[chainId]/page.tsx` | Peer address hiding | PR5 privacy model | — | Explain what each participant sees |
| Dashboard | `/dashboard` | — | — | — | Link to account privacy controls |
| Account / Security | `app/account/page.tsx`, `SecuritySection.tsx` | — | Password processing | — | Reference Privacy Policy |
| Legal & Privacy | `LegalPrivacySection.tsx` | **All "Coming soon"** | **P0** — no published policies | Implies deletion process exists | Replace placeholders; erasure **request** not auto-delete |
| Participation de-link | `ParticipationDelinkPanel.tsx`, presentation | Says history retained | Must contrast with RTBF | Accurate for de-link | Add "not account deletion" cross-link |
| Dormancy warning | `DormancyWarningPanel.tsx`, email template | Release warning | Not erasure | Accurate | Cross-link to lifecycle retention |
| Email verification | `/verify-email`, gate copy | Verification required | — | Accurate | — |
| Invitation flows | API + templates | Full address in some emails | Data minimisation review | — | Review necessity of full address in email |
| EA Command Centre | Agent dashboards | Branch property summaries | EA access scope | — | EA data responsibility statement |
| EA onboarding | `/estate-agents/onboarding` | Company/branch PII | — | — | Privacy at collection |
| Footer | Global | May lack policy links | Art. 13/14 | — | Privacy, Terms, Cookies, contact |
| Privacy Policy | Not published | Missing | **P0** | — | Full draft — legal review |
| Terms | Not published | Missing | **P0** | — | Shared platform responsibilities |
| Cookie Policy | Not published | Missing | PECR if non-essential cookies | No analytics SDK today | Essential cookies only statement |
| Account deletion / erasure | Placeholder only | "Account Deletion Request" coming soon | Must say **request** + manual process | Implies instant delete | Link to privacy@ + 1-month statutory vs 72h internal |
| Contact / privacy routes | Missing dedicated page | — | Art. 13 contact | — | `/privacy` or mailto privacy@ |
| Email: homeowner invitation | `HomeownerInvitation.tsx` | Full property address | Minimisation | — | Review address necessity |
| Email: property claimed | `PropertyClaimed.tsx` | Address | Same | — | Review |
| Email: dormancy warning | `DormancyWarning.tsx` | No address (good) | — | Accurate | — |
| Email: password reset | Auth + template | Email in transit | — | — | — |
| EA landing | `EaLandingPage.tsx` | "Anonymised regional benchmarks" | Analytics transparency | Phase 3 pipeline may not be live | Align marketing with actual analytics state |
| Production readiness doc | `PRODUCTION_READINESS_CHECKLIST.md` | Dated June 2026 | — | Many items now resolved on Dev | Refresh before launch comms |

---

## Factual inconsistencies (copy vs behaviour)

| Finding | Severity |
|---------|----------|
| Legal section promises account deletion process — **none exists** | **P0** |
| Lifecycle `anonymised` could be read as full GDPR erasure | **P0** — document in policy |
| EA benchmarks marketing vs Phase 3 analytics | **P1** |
| De-link copy accurate; erasure distinction missing | **P1** |

---

## Review sequencing (recommended)

1. Publish Privacy Policy skeleton (legal review)
2. Fix LegalPrivacySection placeholders
3. Sign-up / collection point notices
4. De-link vs erasure distinction across property/account UI
5. Email template minimisation review
6. Footer and contact routes
7. EA-specific responsibilities
8. Marketing accuracy (benchmarks, pricing/Stripe)

---

*Content register only — rewrite in dedicated content phase.*
