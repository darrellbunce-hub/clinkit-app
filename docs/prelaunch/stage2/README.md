# Stage 2 pre-launch proposals: review pack

Status: **PROPOSED — NOT APPLIED.** Nothing in this folder has been run against
any database. The SQL files sit outside `supabase/migrations/` on purpose; the
application changes are patch files, not applied to the working tree.

| File | What it is |
|---|---|
| `20261021100000_start_move_create_property_atomic.sql` | New RPC: Start Move creates a property and grants its homeowner in one transaction |
| `20261021110000_cleanup_abandoned_onboarding_chain_fail_closed.sql` | Replaces the onboarding cleanup so it can only delete an empty chain |
| `20261021120000_ea_assignment_visibility_seller_side.sql` | Narrows who can identify a seller's Estate Agent or the seller (assignments, branch labels, delink events, claim metadata) |
| `20261021130000_former_branch_scope_and_delink_options.sql` | Ends former-branch read access (lifecycle, dashboard, property rows) and adds a property-authorisation gate to `get_participation_delink_options` |
| `20261021140000_activity_actor_attribution.sql` | Separate security fix: the "Homeowner" / "Estate Agent" label on activities is derived from authority on every write path, and the four activity-writing RPCs no longer reveal whether an id exists |
| `20261021150000_probe_and_reconnect_confidentiality.sql` | Appointment no longer reveals property existence and no longer refuses (or reveals) a branch because it sells another household's home in the chain; reconnection fails closed; four internal helpers lose end-user execute; the shared chain view stops returning other rows' creator ids |
| `20261021160000_existence_probes_and_helper_grants.sql` | The remaining user-callable functions stop answering "not found" before authorisation (B3); six unguarded helpers move to `service_role`; `get_next_chain_position` answers only chain participants; `execute_participation_delink` loses its PUBLIC grant |
| `20261021170000_chains_attribution_guard.sql` | Direct client writes to `chains` can only attribute the caller (B2, write side) |
| `start-move-atomic-create-app.patch` | Start Move client, grants helper, RPC allowlist and the verifiers that pin Start Move |
| `a1-operational-context-strip-app.patch` | A1: the operational context strip appears only on the page its labels describe |
| `b1-assignment-error-copy-app.patch` | B1: removes the "This branch represents the buyer of this property…" message, which `150000` makes unreachable |
| `20261021180000_branch_entitlement_access_revocation.sql` | B5: two `service_role`-only functions that revoke a branch's active assignments when its entitlement ends, plus reconciliation for the daily cron. Adds `entitlement_expired` (assignment) and `branch_access_ended` (delink event) reason codes |
| `20261021190000_chain_nodes_own_view.sql` | B2 read side: `chain_nodes_own`, an owner view returning only the caller's own chain nodes (and so only the caller's own user id) |
| `20261021200000_shared_chain_user_id_column_privileges.sql` | B2 read side: `authenticated` loses SELECT on the user-id columns of `chains`, `chain_nodes`, `operational_delays` and `chain_completion_events`; every other column stays readable under the existing RLS |
| `b2-shared-chain-user-ids-app.patch` | B2 read side: the chain page and completion writers stop reading other participants' user ids; own nodes come from `chain_nodes_own` |
| `b5-branch-access-ended-notice-app.patch` | B5: the neutral "Branch Access Ended" notice on the homeowner's property page (no email, no template change) |
| `legacy-assignment-audit.development-readonly.sql` | Task E: read-only Development audit of active assignments against the seller-side rules. Not run |

Offline check: `npx tsx scripts/verify-prelaunch-stage2-proposals.ts`.
The proposal SQL is generated from the current migration text by exact,
single-occurrence replacements; the verifier re-derives each copy
independently.

Status of the review: this pack does not claim any Stage is accepted or
Production-ready. Blockers are in section 7.

---

## 1. `start_move_create_property` (atomic create and grant)

### Problem

Start Move inserts each property from the browser and then calls
`establish_operational_homeowner_for_created_property`. If the second call
fails, the row survives with no seller side. An addressed row with no seller
side is `awaiting_seller`, which counts as reserved, so the homeowner is
locked out of their own address. Today the client then calls the cleanup,
which deletes the row — that is the behaviour item 2 removes.

### Signature and grants

`public.start_move_create_property(p_chain_id bigint, p_relationship_type text, p_address text, p_postcode text, p_awaiting_buyer boolean default false) returns jsonb`

SECURITY DEFINER, `search_path = public`, owner `postgres`. `revoke all … from public, anon`; `grant execute … to authenticated, service_role`. Added to
`scripts/secdef-user-rpc-allowlist.json` (in the app patch).

### Validation, in order

Because the function runs as the owner, the protections on a direct insert
do not run for it: the `properties_insert_creator` RLS policy does not apply,
and `_trg_properties_guard_direct_writes` returns early unless
`current_user = 'authenticated'`. Each of those checks is reimplemented:

| # | Check | Result on failure |
|---|---|---|
| 1 | `_require_verified_email_for_transaction()` | that function's own error object |
| 2 | `auth.uid()` present | `not_authenticated` |
| 3 | `_is_estate_agent_account(uid)` is false | `estate_agent_cannot_be_homeowner` |
| 4 | relationship type is `sale` or `purchase` | `invalid_relationship_type` |
| 5 | trimmed address and postcode both non-empty (`properties_stage_address_invariant`) | `invalid_address` |
| 6 | lock the chain row `FOR UPDATE` | — |
| 7 | chain exists, `created_by_user_id = uid`, `caller_may_place_property_in_chain`, `caller_owns_unshared_chain` | `not_authorized` (one error for missing and foreign chains: no existence oracle) |
| 8 | no row of the same relationship type already in the chain | `property_already_in_chain` |
| 9 | `property_exists_for_onboarding(address, postcode, null)` is false | `address_unavailable` |
| 10 | insert, then `_establish_operational_homeowner_core(id, uid, 'start_move', false)` | see rollback |

The creator is always `auth.uid()`; no parameter can set it, the link column
or the stage. The inserted values are identical to today's client inserts
(sale: position 1, `property_listed`, `seller_connected`; purchase: position 2,
`offer_accepted`, `buyer_connected`; both `pending_connection`,
`is_current_user`, `last_updated_days = 0`).

`trg_properties_address_reservation` still fires for every role and stays the
backstop for a race between step 9 and the insert.

### Rollback behaviour

Steps 1–9 return before any write. Step 10 runs in a nested
`BEGIN … EXCEPTION` block (a savepoint):

- The reservation trigger raises `23505 property_address_reserved` → the
  savepoint rolls back the insert → returns `address_reserved`.
- The grant returns `ok = false` → the function raises
  `P0001 start_move_create_property_grant_failed` inside the block → the
  savepoint rolls back the insert and anything the grant wrote → returns the
  grant's own error code.
- Any other error (another unique violation, a constraint, a raise from a
  helper) is re-raised, so the whole call fails and PostgreSQL rolls back the
  transaction. There is no `WHEN OTHERS`.

In every failure the property row does not exist afterwards. On success the
response is `{ ok: true, property_id, chain_id }`.

### Application change (patch)

- `lib/ownership/grants.ts`: new `createStartMoveProperty()` calling the RPC,
  returning `{ ok: true, propertyId } | { ok: false, error }`.
- `app/start-move/page.tsx`: the sale and purchase direct inserts and their
  separate grant calls are replaced by `createStartMoveProperty`.
  `propertyEstablished` is set only after it succeeds. `address_reserved` and
  `address_unavailable` show the existing "address has just been added…"
  message; purchase failures keep the `purchase_address_reserved` /
  `purchase_not_added` recovery. The onward-purchase link, Searching and
  Buyer Ready steps are unchanged. No convergence or access-code logic is
  touched.
- Five offline verifiers updated to the new shape with the same strictness
  (`verify-help-and-start-move-recovery`, `verify-start-move-guided-answers`,
  `verify-start-move-onward-purchase-link`,
  `verify-operational-authority-migration`,
  `verify-properties-chain-integrity-migration` — Start Move leaves the
  direct-`properties`-write inventory).

Trial result with the patch applied: `tsc` clean, ESLint clean, all 14
offline Start Move / authority / reservation verifiers pass. The patch was
then reverse-applied; the Stage 1 tree is byte-identical to before.

---

## 2. `cleanup_abandoned_onboarding_chain` (fail-closed)

### Problem

The current body (`20261005100000`) deletes activities, memberships,
properties, chain nodes and the chain whenever the caller created the chain
and nobody else can see it. Foreign keys then cascade into property history
(lifecycle states and events, delink events, operational identities, claim
metadata and invitations, EA assignments, reconnection events). A homeowner
whose chain nobody has joined yet can lose an established sale.

### Behaviour, in order

| # | Check | Result |
|---|---|---|
| 1 | `auth.uid()` present | `not_authenticated` |
| 2 | lock chain `FOR UPDATE`; exists and `created_by_user_id = uid` | `not_authorized` |
| 3 | no `properties` and no `chain_nodes` for the chain | `chain_not_empty` |
| 4 | no `chain_completion_events`, `operational_delays`, `property_delink_events`, `property_lifecycle_still_active_confirmations` or `email_events` for the chain | `chain_has_history` |
| 5 | delete the chain's `chain_operational_refresh_queue`, `chain_operational_summary` and `property_operational_summary` rows (derived caches) | — |
| 6 | delete the chain, scoped to `created_by_user_id = uid` | `{ ok: true, empty_chain: true }` |

It never deletes a property, membership, activity, node or history row.
Step 5 matters for Join Chain: when a property moves to the joined chain its
cached summary row can still carry the old chain id, and without removing it
the empty source chain could never be cleaned up. The refresh worker rebuilds
the cache under the property's current chain.

`p_require_empty` is kept so the three callers (Start Move, Join Chain
`p_require_empty: true`, EA originate `p_require_empty: true`) and the
existing grant keep working, but the body ignores it: every call is
empty-only.

The function body is a single statement sequence; any error aborts the call
and nothing is deleted.

### Preflight

Refuses to install if the `(bigint, boolean)` function is missing, the legacy
`(bigint)` overload exists, the current body does not match `20261005100000`,
any checked table is missing, or **any foreign key to `public.chains` comes
from a table not in the checked list**. That last check covers the core
tables whose constraints predate the migrations folder.

### Grants

Unchanged: `authenticated, service_role`; `revoke all … from public, anon` is
restated. Allowlist entry unchanged.

---

## 3. Confidentiality model (Business Rules 3.4, 9.8, 19.23, 24.7, 25.27, 25.35)

Proposed wording for the rules: `../business-rules-ea-identity-confidentiality.md`
(transfer document; the Google Doc has not been changed).

### The model

- **One shared chain view for everyone in the chain.** Homeowners and Estate
  Agents see the same thing: each position's status, progress, timeline
  updates and the generic labels "Homeowner" and "Estate Agent". A label
  says what kind of participant acted, never who.
- **Confidential from other participants:** another homeowner's name,
  identity or contact details; which agent represents another participant;
  another agent's name, branch or agency; assignment details, or metadata
  from which they can be inferred; private branch-access events; another
  participant's invitation details.
- **Own workspace.** A homeowner sees the agent assigned to their own sale.
  Current staff of an agency branch manage that branch's own assignments in
  the agent workspace, which never shows other agents.
- **No exceptions.** There is no permission, request or consent process
  through which one participant can see another's confidential details, and
  this pack adds none.
- **"Estate Agent Connected"** may appear in the shared timeline as a generic
  event, with no name or branch. It is optional.
- **"Branch Access Ended"** is not a shared timeline event. Only the directly
  affected homeowner and authorised users of the affected agency may see it.
- **Leaving ends access.** A former branch, a removed homeowner and a former
  participant keep no read access to identifiable data, including as the
  person who created the row. Records are retained for audit; retention is
  not read access.
- Enforced on the server (RLS, SECURITY DEFINER checks, grants). Hiding
  something in the UI is not enough.

### Access-control matrix

"Shared chain view" is what every current chain participant sees, homeowner
or agent alike. "Operational workspace" is the homeowner's own property and
the agency's own assignments.

| Data | Shared chain view (every current chain participant) | Homeowner's own workspace | Agency workspace (current members of the assigned branch) | Former branch, removed homeowner, former participant | Unrelated signed-in user |
|---|---|---|---|---|---|
| Position, stage, status, progress, alerts (`chain_properties_participant`, summaries, intelligence) | yes | yes | yes | no | no |
| Timeline text and generic actor label (`activities`) | yes | yes | yes | no | no |
| Another row's address and postcode | no | own row only | assigned rows only | no | no |
| Another row's creator or member user id | no (own id only, `150000`) | — | — | no | no |
| Other participants' user ids on `chains`, `chain_nodes`, `operational_delays`, `chain_completion_events` | **yes today**; no after `200000` (own node's id only, via `chain_nodes_own`) | own node only | own node only; the represented homeowner's id via `ea_operational_assignments` (assigned rows) | no | no |
| "Branch Access Ended" event (`branch_access_ended`, `180000`) | no (never on the timeline) | own sale | events naming own branch, while a current member | events naming own branch only | no |
| Revoked assignment rows and `entitlement_expired` reason | no | no | no | no | no (`service_role` only, `120000`) |
| Which branch / agent acts on a row (`property_ea_assignments`, branch label RPC) | no | own sale's agent | own branch's rows | no | no |
| Whether another household's sale uses the same branch (appointment answer, `150000`) | no | no (the answer never depends on another row) | own branch's rows only | no | no |
| Seller's invite name and email (`property_claim_metadata`) | no | own row | assigned row | no | no |
| Branch-bearing delink events (removal, release, "Branch Access Ended") | no | own sale | events naming own branch | events naming own branch only (no successor) | no |
| Lifecycle state (`property_lifecycle_states`) | current operational participants of that row | yes | assigned rows | no | no |
| Branch dashboard rows (`agent_branch_property_summaries`) | — | — | active assignments only | no | no |
| Reconnect list (`list_reconnectable_ea_properties`) | — | — | empty (`150000`) | empty | empty |
| Delink options (`get_participation_delink_options`) | empty | own options | own branch's option | empty | empty |

### Roles used (existing; none invented)

- **Seller-side homeowner:** `is_property_seller_side_homeowner` (`20261005110000`):
  the active operational identity holder of a sale, or the single active
  counterparty seller on a purchase.
- **Operational homeowner:** active row in `property_operational_identities`.
  On a purchase row this is the **buyer**.
- **Branch member:** a row in `ea_branch_members`. Roles are `branch_admin`
  (Owner) and `agent` (Staff). There is no status column (removal deletes the
  row), and each user belongs to at most one branch.
- **Actively assigned branch:** `is_ea_assigned_to_property` (an active
  `property_ea_assignments` row for a branch the caller belongs to).
- **Chain viewer:** `is_chain_operational_viewer` (member of a chain row, or
  the actively assigned branch).

**Ambiguity, flagged rather than resolved (blocker B6):** there is no
per-staff assignment. Every existing helper treats every current member of
the assigned branch as authorised, and role checks exist only for team,
branch, company and billing management. This pack therefore reads
"authorised agency users" as current members of the branch. It does not
widen that; it only removes access that outlived the assignment or
membership.

---

## 4. Every disclosure path and its protection

"Today" is the repository migrations as written, not a live database.
**Bypass** describes what stops a direct PostgREST or SQL call from going
around the app.

### Tables and views

| Path | Returns | Who reads it today | Identity / contact / branch / assignment data | Proposed audience | Bypass protection |
|---|---|---|---|---|---|
| `property_ea_assignments` | branch id, status, update permission | any property member (includes the buyer), any branch ever assigned | branch (identifies the agent via the public directory) | active rows: seller-side homeowner; staff of that row's branch (`120000`) | SELECT RLS policy; no table grant change |
| `property_claim_metadata` | invite name, invite email, originating user | any property member, assigned branch | name, email | seller-side homeowner; actively assigned branch (`120000`) | SELECT RLS policy |
| `property_delink_events` | actor, reason, metadata (`branch_id`, user ids) | actor; any past or present identity holder; any branch ever assigned | branch, user ids | actor; events with `branch_id`: seller-side homeowner and that branch's staff; events without: active identity holder and assigned branch (`120000`) | SELECT RLS policy; preflight refuses a delink writer that records a branch under another key |
| `properties` | full row (address, postcode, creator) | members, assigned branch, creator while no members | address, creator id | members; assigned branch; creator only before any member, assignment, identity row or delink event (`130000`) | SELECT RLS policy + definer helper that answers only for the caller's own rows |
| `chain_properties_participant` (owner view) | every row in the caller's chains: status, stage, links, `created_by_user_id`; address only for own or assigned rows | chain viewers | creator user id of every row | same rows; `created_by_user_id` only when it is the caller (`150000`) | view runs as owner with `auth.uid()` and `is_chain_operational_viewer` filter; anon has no grant |
| `property_lifecycle_states` | lifecycle state | operational participants, **plus staff of any branch ever assigned** | none directly; tells a former branch what happened to the property | current operational participants (`130000`) | SELECT RLS policy |
| `agent_branch_property_summaries` (owner view) | address, postcode, stage, alerts, claim and invite status for the branch's assignments | branch members, **including revoked assignments** (invite email included) | address, invite email | branch members, active assignments only (`130000`) | view filter on `auth.uid()` membership and `status = 'active'` |
| `ea_operational_assignments` (owner view) | current branch's assignments, subject user | current branch members, active only | own branch's data | unchanged | already scoped |
| `property_operational_summary`, `chain_operational_summary`, `get_chain_operational_intelligence` | stages, alerts, clocks | chain viewers (active-only helpers) | none (generators emit no names) | unchanged (shared view) | RLS / definer with chain-viewer check |
| `activities` | timeline text, `updated_by` label | chain viewers | label only; text is allowlisted by `trg_enforce_structured_activity_update` | unchanged (shared view); label derived (`140000`) | INSERT policy unchanged; BEFORE INSERT trigger rewrites `updated_by` for direct client inserts; no UPDATE/DELETE policy (preflight refuses if one appears) |
| `operational_delays` | reason, status, roles, `created_by_user_id`, `resolved_by_user_id` | chain viewers | bare user ids (**B2**); roles are now derived (`140000`) | unchanged in this pack | B2 |
| `chain_nodes` | Buyer Ready nodes incl. `user_id` | chain viewers | bare user id (**B2**) | unchanged in this pack | B2 |
| `chains`, `chain_completion_events` | completion user ids, actor ids | chain viewers; any operator of the chain could **write** another user's id into `created_by_user_id` or a completion column | bare user ids (**B2**) | read unchanged (B2); writes attribute only the caller (`170000`) | BEFORE INSERT OR UPDATE trigger for direct client writes |
| `profiles`, `property_members`, `property_operational_identities`, `property_counterparty_participants` | own rows | own rows | — | unchanged | RLS own-row |
| `property_delegates` | delegation rows | delegate or inviter | user ids of the two parties only | unchanged | RLS |
| `ea_branches`, `ea_companies`, `ea_branch_members`, `ea_branch_invitations` | branch and team data | own company / branch; invitations: admins | own agency only | unchanged | RLS |
| `property_ea_reconnection_events`, `property_claim_invitations`, `email_events` | audit | no participant read policy | — | unchanged | no grant / no policy |
| `ea_branch_directory`, `search_ea_branch_directory` | entitled branches, names | any signed-in user (by design) | public directory, no assignment data | unchanged | — |

### RPCs

| Path | Returns | Who can call / learn today | Identity / branch / assignment data | Proposed | Bypass protection |
|---|---|---|---|---|---|
| `get_property_ea_branch_entry` | branch and company name for a property | any property member, assigned branch | agent identity | seller-side homeowner; staff of the actively assigned branch (`120000`) | definer check inside the function |
| `assign_property_ea_branch` | ok / error | seller-side homeowner may appoint; **anyone** learns whether a property id exists (`property_not_found`); a seller is refused, as `branch_acts_for_buyer`, the branch that sells the buyer household's own home, which tells the seller that household's agent | existence; another household's agent | unknown and foreign ids both `not_authorized`; the linked-sale refusal is removed, so the answer depends only on the caller, the target row and the branch (`150000`, **B1**) | definer; postflight checks the ACL, the check order and that the body reads no other row's assignment |
| `get_participation_delink_options` | options, signals | anyone: existence, `invitation_pending`, `meaningful_participation` | invitation state | operational homeowner, seller-side homeowner, assigned branch; everyone else (and unknown ids) an identical empty answer (`130000`) | definer gate before anything is computed |
| `list_reconnectable_ea_properties` | address, postcode, branch name, end date | former branch after `homeowner_left_cascade` | address of a property it no longer manages | always empty (`150000`, **B4**) | function body returns a constant |
| `reconnect_returning_ea_branch` | re-creates the former branch's assignment with no homeowner | former branch | grants itself access again | always `not_reconnectable` (`150000`, **B4**) | function body returns a constant; audit table kept |
| `resolve_convertible_searching_placeholder_for_sale` | placeholder id and owner for any sale id | any signed-in user, no caller check | topology, owner | service_role only (`150000`) | execute revoked; no remaining caller |
| `get_active_ea_branch_invitation` | any branch's active invitation for any email (name, inviter id, token hash) | any signed-in user, no caller check | name, email, inviter | service_role only (`150000`) | execute revoked; no remaining caller |
| `user_has_ea_branch_membership(uuid)` | whether a user id is an agent | any signed-in user | resolves a bare user id to "is an Estate Agent" | service_role only (`150000`) | execute revoked; caller `accept_ea_branch_invitation` is definer |
| `user_email_has_ea_branch_membership(text)` | whether an email belongs to an agent | any signed-in user | email enumeration | service_role only (`150000`) | execute revoked; caller `create_ea_branch_invitation` is definer |
| `report_operational_delay` | delay + timeline activity | operators; anyone learns property / node existence | label chosen by client; existence | label derived; unknown and foreign targets both `forbidden` (`140000`) | definer copy |
| `resolve_operational_delay` | resolution | operators; anyone learns delay existence and a resolved delay's reason and time | label; another property's delay reason | label derived; `forbidden` for unknown and foreign; idempotent answer only after authorisation (`140000`) | definer copy |
| `break_chain_connection` | ok / error + activity | operators; anyone learns existence | label from `profiles.account_type` | label derived; unknown and foreign both `not_authorized` (`140000`) | definer copy |
| `convert_searching_placeholder_for_sale` | converted row + activity | operators; anyone learns existence and whether a row is searching | label from `profiles.account_type` | label derived from the anchor row; authorisation before any row-specific error (`140000`) | definer copy |
| `confirm_transaction_still_active` | ok / error, "managed" no-op | anyone learns whether a property id exists and whether an agent manages it | existence, managed state | unknown and foreign ids `not_authorised`; the managed answer only for the dependent side or an operator (`160000`) | definer copy; postflight compares ACL and order |
| `create_searching_placeholder_for_sale` | placeholder id | anyone learns sale existence (`sale_not_found`) | existence | unknown and foreign `not_authorized`, before `invalid_sale` (`160000`) | definer copy |
| `link_sale_to_searching_placeholder` | ok / error | anyone learns whether two ids exist and share a chain | existence, topology | `forbidden` until the caller operates the sale; then a missing or other-chain placeholder is `chain_mismatch` (`160000`) | definer copy |
| `establish_connected_hop` | ok / error | anyone learns purchase existence | existence | unknown and foreign `not_authorized`, before `not_purchase` (`160000`) | definer copy |
| `execute_participation_delink` (three wrappers and the four-argument form) via `_execute_participation_delink` | ok / error | anyone learns property existence; the four-argument form was still executable by PUBLIC | existence | an unknown id gets the operation's own refusal (`not_operational_homeowner`, `branch_required`, `not_assigned_ea`); PUBLIC and anon revoked (`160000`) | definer copy; core stays service_role-only |
| `create_ea_operational_property` | new row | any branch member learns whether a chain id exists (`chain_not_found`) | existence | `not_authorised_for_chain` for unknown and foreign chains (`160000`) | definer copy |
| `get_next_chain_position` | max position + 1 | any signed-in user, for any chain | how many positions another chain has | the real answer only for callers who may place, view or operate in the chain; otherwise 1 (`160000`). The app already treats a missing answer as 1 | definer, stable SQL |
| `get_property_operational_owner_user_id` | the active homeowner's user id | any signed-in user, any property | bare user id of another homeowner | service_role only; its policy use becomes `is_property_operational_homeowner(id)` (`160000`) | execute revoked; preflight checks every caller |
| `chain_last_operational_activity_at`, `property_chain_is_connected`, `homeowner_has_meaningful_participation`, `property_invitation_is_pending`, `property_has_any_member` | timestamps, booleans | any signed-in user (two were still PUBLIC) | activity timing, connection, whether an id exists, has members or is agent-originated and unclaimed | service_role only (`160000`) | execute revoked; preflight refuses a policy, view, invoker or other-owner caller |
| Claim and join functions (`claim_*_invitation`, `claim_operational_property`, `reject_*`, `join_chain_property`, `establish_operational_homeowner*`), `get_participation_delink_options` | ok / error | the caller | already authorise first, or are gated by an invitation token or code; not-found answers keyed by a random token or UUID are reviewed as low risk | unchanged | definer checks |
| `is_ea_branch_commercially_entitled`, `is_smoke_test_ea_branch` | boolean by branch id | any signed-in user | billing or test status of a branch (no person, no assignment) | unchanged; residual, low | — |
| `discover_claimable_properties`, `resolve_claim_invitation_token` | branch name for the invited seller | the invited seller (email match) | own agent before claim | unchanged | definer checks |
| `invite_property_delegate(bigint, uuid, …)` | ok / error | the operational homeowner | accepts an arbitrary user id; returns nothing about that user | unchanged (noted under **B2**) | definer check |
| `get_ea_branch_team_directory`, team and billing RPCs | own branch team | branch members / managers | own agency only | unchanged | definer checks |
| Boolean self-checks (`is_ea_assigned_to_property`, `is_property_member`, `can_operate_property`, …) | true / false for the caller | caller | caller's own status only | unchanged | — |

### Application, API routes, server actions, email

- **Shared chain UI** (`context/ChainContext.tsx`) reads
  `chain_properties_participant`, `activities`, `operational_delays`,
  `chain_nodes` and `chains`. It maps `created_by_user_id` but nothing reads
  another row's creator (asserted offline). Own-node and completion checks
  use `chain_nodes.user_id` and `chains` completion ids, so those columns
  need an app change before they can be masked (**B2**).
- **Route guard** (`lib/auth/propertyAccess.ts`) selects only `id` from
  `chain_properties_participant`.
- **`PropertyEstateAgentAssignment`** is mounted only for the viewer's own
  sale position or `canEdit` non-agent viewers, and reads active rows only.
- **App item A1:** on another property's page, `OperationalContextStrip`
  shows the viewing agent's own branch as "Operational manager". It names no
  other agent (not a leak), but it misattributes: the owner, manager and mode
  labels come from `operationalSubject.assignedPropertyId`
  (`hooks/useOperationalWorkspaceLabels.ts`), which is the agent's assigned
  property in the chain, not the page's property. Fix:
  `a1-operational-context-strip-app.patch` shows the strip to an agent only
  on that assigned property's page, and to everyone else only where
  `isOperationalDisplay` (their own position). Labels, manager lookup and
  badges are unchanged. Trial-applied: `tsc` clean, ESLint unchanged from
  the baseline (one pre-existing error at `app/property/[propertyId]/page.tsx`
  line 280, four warnings), `verify-stage6-terminology` passes; then
  reverse-applied.
- **Reconnect page** (`app/agent/reconnect`, `AgentCommandCentre`) lists
  nothing for an empty result and shows the generic refusal (asserted).
- **API routes** (`app/api/**`): every route has a session, cron secret,
  admin or environment guard (pattern check only; not re-audited line by
  line in this pass). `operational-intelligence/refresh` returns state only.
  `communications/homeowner-invitation` reads claim metadata with the
  agent's session, which `120000` still admits for the assigned branch.
- **Server actions:** only `lib/privacyAdmin/actions.ts` and
  `lib/auth/platformAdminMfaActions.ts` (platform admin).
- **Emails** naming a branch or company go only to the represented seller or
  branch staff.

---

## 5. Known risks 1–7

| # | Risk | Resolution |
|---|---|---|
| 1 | Reconnect list returns the address to a former branch | `150000`: list always empty, reconnect always refused. Business decision needed to keep it that way (**B4**) |
| 2 | Removed homeowner or creator keeps reading the row | `130000`: creator bootstrap only while the row has never had a member, assignment, identity row (any status) or delink event |
| 3 | Delink options answer anyone | `130000`: uniform empty answer for everyone without a role, including unknown ids |
| 4 | Former branch keeps lifecycle, dashboard and delink metadata | `130000` (lifecycle, dashboard, property rows) and `120000` (assignments, delink events, claim metadata) |
| 5 | Bare user ids resolvable | `profiles` is own-row only; `150000` revokes `user_has_ea_branch_membership` and `user_email_has_ea_branch_membership` and masks `created_by_user_id` in the shared view; `160000` revokes `get_property_operational_owner_user_id` (property id → homeowner user id); `170000` stops a direct write attributing a chain or completion step to someone else. No remaining user-callable function turns a user id into a name, email or role (offline scan of every function with a uuid parameter). Ids that remain readable in shared tables cannot be resolved but allow cross-chain correlation (**B2**, read side) |
| 6 | Client-chosen actor labels | `140000`: trigger for direct inserts; the four user-callable writers derive the label; preflight refuses if any other user-callable function writes activities. `system` stays for the service_role-only notice helpers |
| 7 | "Branch Access Ended" in the shared timeline | Not implemented anywhere. `120000` already limits any branch-bearing delink event to the homeowner and that branch; the offline verifier fails if the phrase appears in code. Implementation is **B5** |

---

## 6. Proposal details

### `20261021120000` (unchanged in this revision)

Assignments, branch label RPC, delink events and claim metadata, as in the
tables above. Preflight fingerprints the three policies and the function,
refuses extra policies on those tables, and refuses a live delink writer
that stores a branch under a key other than `branch_id`.

### `20261021130000` former-branch scope and delink options

| Object | Change |
|---|---|
| `property_lifecycle_states_select_participant` | `is_property_operational_participant(property_id)` only |
| `agent_branch_property_summaries` | copied verbatim from `20261006120000` with `pea.status = 'active'` |
| `properties_select_member_or_agent` | creator clause moved into `is_property_creator_bootstrap_viewer(id)`: creator, no members, and never an assignment, identity row (any status) or delink event |
| `get_participation_delink_options` | copied verbatim from `20261005120000` except the uniform empty answer and seller-side-only signals |

Preflight: every object exists (including `property_operational_identities`
and `property_delink_events`); the lifecycle policy still has the
branch-member clause and no status filter, with no other read policy; the
view still contains `'revoked'::text` and `security_invoker=false`; the
properties policy has its four clauses and no other read policy; the helper
does not exist yet; the options body still has `property_not_found` and its
current signal lines.

### `20261021140000` activity actor attribution and probe answers

- `_activity_actor_role(property_id)` (SQL, invoker, stable): `estate_agent`
  when the caller is the actively assigned branch and not the seller-side
  homeowner; otherwise `homeowner`. Never reads `profiles`.
- BEFORE INSERT trigger on `activities`: for `current_user = 'authenticated'`
  (a direct client insert), `updated_by` is replaced by the derived label.
- `report_operational_delay`, `resolve_operational_delay` (from
  `20261005120000`), `break_chain_connection` (from `20261005120000`) and
  `convert_searching_placeholder_for_sale` (from `20261005110000`) are
  verbatim copies except: the derived label; not-found merged into the
  authorisation answer; `resolve` returns its idempotent "already resolved"
  answer (reason, time) only after authorisation.
- `convert` authorises on the anchor sale and writes the activity on the
  converted purchase, so the label is derived from the anchor inside the
  function (the trigger does not run for owner-run writes).

Preflight: every function exists; the delay bodies still copy
`p_actor_role`; report, resolve, break and convert still contain their
current not-found answers; break and convert still derive the label from
`account_type`; **no other function executable by `authenticated` inserts
into `activities`**; the insert policy exists; there is no other
INSERT/UPDATE/ALL policy on `activities`; the trigger does not exist yet.

### `20261021150000` probes, reconnection and shared-view identifiers (new)

- `assign_property_ea_branch`: verbatim copy of `20261011090000` except
  unknown and foreign property ids both return `not_authorized` (before the
  searching check), and the `branch_acts_for_buyer` refusal is removed (B1,
  below). No other check changes.
- `reconnect_returning_ea_branch` / `list_reconnectable_ea_properties`: same
  signatures, definer and grants; after the existing email and sign-in
  checks they return `not_reconnectable` / an empty list. No reads, no
  writes.
- Execute on `get_active_ea_branch_invitation`,
  `user_has_ea_branch_membership`, `user_email_has_ea_branch_membership` and
  `resolve_convertible_searching_placeholder_for_sale` moves from
  `authenticated` to `service_role`.
- `chain_properties_participant`: verbatim copy of `20260725140000` except
  `created_by_user_id` is returned only when it equals `auth.uid()`.

Preflight: every object exists; `assign` has the `20261011090000` owner,
definer, `search_path` and body markers (its ACL is saved for the
postflight); the reconnect functions still contain their
`homeowner_left_cascade` logic and the list still returns `p.address`; no
policy, view, invoker function or differently-owned function calls any of
the four helpers; the view has exactly its 18 current columns, the chain
viewer filter and `security_invoker=false`, and is not already masked.

Postflight: `assign` keeps owner, definer, `search_path` and the exact saved
ACL, no longer contains `property_not_found`, `branch_acts_for_buyer`,
`linked_property_id` or the other-row assignment alias, and its checks run in
order (authorisation, searching, directory, revoke, insert). The helpers are executable by `service_role` only, the
reconnect functions by `authenticated` only, and the view is readable by
`authenticated` and not `anon`.

### `20261021160000` existence probes and helper grants (B3)

Callers, purpose and the answer change for each user-callable function:

| Function | App caller | Purpose | Authorisation (existing) | Disclosure today | Proposed answer for unknown and foreign ids | Authorised callers |
|---|---|---|---|---|---|---|
| `confirm_transaction_still_active(bigint)` | `lib/lifecycle/confirmStillActive.ts` | resets the dormancy clock | dependent side of the unrepresented row | `property_not_found`; "managed" no-op for any managed row | `not_authorised` | unchanged; the managed no-op still goes to the dependent side and operators |
| `create_searching_placeholder_for_sale(bigint)` | `lib/searchingPlaceholder.ts` | adds the "searching" purchase for a sale | `can_operate_property(sale)` | `sale_not_found` | `not_authorized` | `invalid_sale`, duplicate and success answers unchanged |
| `link_sale_to_searching_placeholder(bigint, bigint)` | `lib/searchingPlaceholder.ts` | joins a sale to a searching row in the same chain | operator of the sale | `property_not_found`, `chain_mismatch` before authorisation | `forbidden` | then `chain_mismatch`, `invalid_sale`, `invalid_searching_placeholder` as today |
| `establish_connected_hop(bigint, …)` | `lib/chainConnection.ts` | connects a purchase to the next sale | operator of the purchase | `purchase_not_found` | `not_authorized` | `not_purchase` and later answers unchanged |
| `execute_participation_delink*` → `_execute_participation_delink` | `lib/ownership/participationDelink.ts`, `lib/ownership/delink.ts` | homeowner leaves, homeowner removes agent, agent releases, agent removes homeowner | per operation | `property_not_found` | the operation's own first refusal (`not_operational_homeowner` / `branch_required` / `not_assigned_ea`) | unchanged |
| `create_ea_operational_property(bigint, …)` | `lib/estateAgent/originateOperationalProperty.ts` | agent adds a row to a chain | branch member, and the branch is assigned in the chain or the caller created the empty chain | `chain_not_found` | `not_authorised_for_chain` | unchanged (a missing chain already fails both tests) |
| `get_next_chain_position(bigint)` | `getNextChainPosition` in `lib/searchingPlaceholder.ts` (falls back to 1) | next position number | none | size of any chain | 1 | unchanged |

Owner errors stay useful: every authorised caller receives the same code as
today, in the same order (static order check plus model case 20). Only the
answer to a caller with no role on the row changes.

Helpers: `get_property_operational_owner_user_id`,
`chain_last_operational_activity_at`, `property_chain_is_connected`,
`homeowner_has_meaningful_participation`, `property_invitation_is_pending`
and `property_has_any_member` move to `service_role`. The preflight refuses
if any of them has a second overload or is called by a policy, a view, an
invoker function or a function with another owner. The only policy use,
`properties_update_operator`, is recreated with
`is_property_operational_homeowner(id)`, which is equivalent because
`property_operational_identities_one_active_per_property` allows one active
identity per property (the preflight requires the index).

Residual: `confirm_transaction_still_active` and
`create_searching_placeholder_for_sale` take their `FOR UPDATE` row lock
before authorising, as today. An outsider can make a call wait on a locked
row but receives the same answer; timing is not addressed.

Preflight: definer, `search_path`, owner `postgres` and body markers for
each function (ACLs saved); return types; policy text; helper callers.
Postflight: ACL, owner and config unchanged; no not-found strings; check
order; the new policy predicate; helper grants; anon has no delink execute.

### `20261021170000` chains attribution guard (B2, write side)

`_trg_chains_enforce_attribution()` (invoker, owner `postgres`, no execute
grant), BEFORE INSERT OR UPDATE on `chains`, only for
`current_user = 'authenticated'`: on insert the creator and any non-null
completion id become `auth.uid()`; on update the creator is kept and a
changed non-null completion id becomes `auth.uid()`; null is allowed. The
three app writers (`recordChainCompletionDate`,
`amendChainCompletionDate`, `confirmChainCompletion`) already write only
`params.userId`, so nothing changes for them. No app code inserts into
`chains` with a user session (chains come from definer RPCs; the smoke-test
fixture inserts as `service_role`, which the trigger skips). Preflight refuses if another
BEFORE trigger exists on `chains`. The existing AFTER triggers are
unaffected. Rollback: drop the trigger and function.

### `20261021180000` branch entitlement revocation (B5)

Preflight: the required tables and helpers exist; neither new function
exists; the `120000` policies are live (assignment and delink-event
visibility; otherwise it refuses with "apply 20261021120000 first"); neither
constraint already contains the new code. Then:

- `property_ea_assignments.revocation_reason` check gains
  `entitlement_expired`; `property_delink_events.reason_code` check gains
  `branch_access_ended`. No existing code fits: the assignment codes describe
  homeowner or agent actions, and the delink codes would either name billing
  or imply the transaction changed. Two codes are used so that the exact
  reason stays on the revoked row (`service_role` only) while the readable
  event carries only the approved wording (25.33, 25.36).
- `revoke_ea_branch_access_after_entitlement_end(p_branch_id uuid) returns jsonb`:
  locks the branch row; returns without change for smoke-test fixtures,
  branches with no subscription row and entitled branches (each counted);
  otherwise, for each active assignment (`for update`): revokes open claim
  invitations (`_revoke_open_property_claim_invitations`), sets
  `status = 'revoked'`, `revocation_reason = 'entitlement_expired'`, and
  inserts one `property_delink_events` row
  `(property_id, chain_id, actor null, 'system', 'branch_access_ended', {operation, branch_id})`.
  Returns counts only.
- `reconcile_ea_branch_entitlement_access() returns jsonb`: applies due grace
  expiry (`apply_ea_branch_grace_expiry_if_due` for each `grace` subscription
  past `grace_ends_at`), then calls the revoke function for every branch that
  still holds active assignments and is not entitled. Returns
  `ok, grace_expired, unentitled_branches_with_assignments, branches_skipped, assignments_revoked, invitations_revoked`.
- Both: `security definer`, `search_path = public`, owner `postgres`, revoked
  from `public, anon, authenticated`, granted to `service_role`. Idempotent
  (a second call finds no active assignment); one transaction per call, so no
  partial transition (26.7, 26.8).
- Not touched: `activities`, `_notify_chain_participants_of_delink`,
  `properties`, claim metadata, identities, lifecycle states, chain topology
  and reconnection. The existing assignment triggers (lifecycle refresh,
  summaries) fire as for any revocation.

Postflight checks grants, that neither body mentions the untouched objects,
and both constraints. Rollback: drop both functions; restore the
constraints only if no row uses the new codes.

### `20261021190000` own chain nodes view (B2, read side)

`chain_nodes_own` (`security_invoker = false`, owner `postgres`):
`id, chain_id, node_type, linked_property_id, user_id` from `chain_nodes`
where `auth.uid() is not null`, `user_id = auth.uid()` and
`is_chain_operational_viewer(chain_id)`. It can only return the caller's own
id, and only in chains the caller can still view (a removed participant gets
nothing). `select` to `authenticated` only. Preflight: table, helper and the
five columns exist; the view does not. Postflight: grants and the two
predicates in the view definition. Additive; safe before the app change.

### `20261021200000` user-id column privileges (B2, read side)

For `chains` (`created_by_user_id`, `completion_date_recorded_by_user_id`,
`completion_date_updated_by_user_id`, `completion_confirmed_by_user_id`),
`chain_nodes` (`user_id`), `operational_delays` (`created_by_user_id`,
`resolved_by_user_id`) and `chain_completion_events` (`actor_user_id`):
revoke table-level SELECT from `authenticated`, then grant column-level
SELECT on every other column (read from `pg_attribute` at apply time). RLS
is unchanged, so rows stay exactly as visible as today; only those columns
become unreadable to end users. Writes (INSERT/UPDATE privileges) are
unchanged. Preflight: tables and columns exist; `authenticated` has
table-level SELECT and `anon` does not; no `security_invoker` view reads the
columns; `chain_nodes_own` exists. Postflight: `has_column_privilege` per
column for `authenticated`, `anon` and `service_role`, and write privileges
kept. **Order: `190000`, then the B2 app patch deployed, then `200000`.**
Rollback: `grant select on table … to authenticated`.

Fail-closed note: a column added to these tables later is not granted to
`authenticated` until a migration grants it. Promotion must record this in
the migration conventions.

### Security and grant summary (all files)

| Function / object | Definer | `search_path` | Owner | Execute / select | Change |
|---|---|---|---|---|---|
| `start_move_create_property(bigint, text, text, text, boolean)` | yes | public | postgres | authenticated, service_role | new (`100000`) |
| `cleanup_abandoned_onboarding_chain(bigint, boolean)` | yes | public | postgres | authenticated, service_role | body (`110000`) |
| `get_property_ea_branch_entry(bigint)` | yes | public | postgres | authenticated, service_role | predicate (`120000`) |
| `is_property_creator_bootstrap_viewer(bigint)` | yes, stable | public | postgres | authenticated, service_role | new RLS helper (`130000`) |
| `get_participation_delink_options(bigint)` | yes | public | postgres | authenticated, service_role | gate (`130000`) |
| `agent_branch_property_summaries` | owner view, `security_invoker=false` | — | — | authenticated (restated) | active only (`130000`) |
| `_activity_actor_role(bigint)` | **no** (invoker), stable | public | postgres | authenticated, service_role | new (`140000`) |
| `_trg_activities_enforce_actor_attribution()` | **no** (invoker) | public | postgres | none (trigger) | new (`140000`) |
| `report_operational_delay(text, bigint, bigint, text)` | yes | public | postgres | authenticated, service_role | label, oracle (`140000`) |
| `resolve_operational_delay(bigint, text)` | yes | public | postgres | authenticated, service_role | label, oracle (`140000`) |
| `break_chain_connection(bigint, text)` | yes | public | postgres | authenticated (`anon` now explicitly revoked; it previously relied on revoke from `public`) | label, oracle (`140000`) |
| `convert_searching_placeholder_for_sale(bigint, text, text)` | yes | public | postgres | authenticated | label, oracle (`140000`) |
| `assign_property_ea_branch(bigint, uuid, boolean)` | yes | public | postgres | unchanged (ACL compared) | oracle; linked-sale refusal removed (`150000`) |
| `reconnect_returning_ea_branch(bigint, uuid)` | yes | public | postgres | authenticated | fail closed (`150000`) |
| `list_reconnectable_ea_properties()` | yes, stable | public | postgres | authenticated | fail closed (`150000`) |
| `get_active_ea_branch_invitation(uuid, text)`, `user_has_ea_branch_membership(uuid)`, `user_email_has_ea_branch_membership(text)`, `resolve_convertible_searching_placeholder_for_sale(bigint)` | yes (unchanged) | public | unchanged | **service_role only** | revoke (`150000`) |
| `chain_properties_participant` | owner view, `security_invoker=false` | — | — | authenticated (restated) | creator mask (`150000`) |
| `confirm_transaction_still_active(bigint)`, `create_searching_placeholder_for_sale(bigint)`, `link_sale_to_searching_placeholder(bigint, bigint)`, `establish_connected_hop`, `create_ea_operational_property` | yes | public | postgres | unchanged (ACL compared) | oracle (`160000`) |
| `_execute_participation_delink` | yes | public | postgres | service_role only (restated) | oracle (`160000`) |
| `execute_participation_delink(bigint, text, text, uuid)` | yes | public | postgres | authenticated; **PUBLIC and anon revoked** | grant (`160000`) |
| `get_next_chain_position(bigint)` | yes, stable | public | postgres | unchanged | caller check (`160000`) |
| `get_property_operational_owner_user_id`, `chain_last_operational_activity_at`, `property_chain_is_connected`, `homeowner_has_meaningful_participation`, `property_invitation_is_pending`, `property_has_any_member` | yes (unchanged) | public | postgres | **service_role only** | revoke (`160000`) |
| `properties_update_operator` | policy | — | — | authenticated, UPDATE | predicate swap, equivalent (`160000`) |
| `_trg_chains_enforce_attribution()` | **no** (invoker) | public | postgres | none (trigger) | new (`170000`) |
| `revoke_ea_branch_access_after_entitlement_end(uuid)`, `reconcile_ea_branch_entitlement_access()` | yes | public | postgres | **service_role only** | new (`180000`) |
| `chain_nodes_own` | owner view, `security_invoker=false` | — | postgres | authenticated (select) | new (`190000`) |
| `chains`, `chain_nodes`, `operational_delays`, `chain_completion_events` | — | — | — | authenticated: column SELECT on every column except the user-id columns | table SELECT replaced (`200000`) |

Nothing is granted to `anon` or `public`. The only table grant change is
`200000` (SELECT narrowed to columns for `authenticated`). Policy
changes are SELECT only (`120000`, `130000`), plus one equivalent UPDATE
policy predicate (`160000`). `140000` and `170000` each add one trigger.
`180000` widens two check constraints.
`_activity_actor_role` and the trigger function are invoker on purpose: they
only call existing definer predicates about the caller.

---

## 7. Blockers, assumptions and decisions

### Blocker register

Status words: **proposed** = SQL or patch drafted and verified offline,
not applied; **decision** = waits for a product or business decision;
**open** = technical work not yet drafted.

| # | Item | Status | Evidence | Files | Remaining risk |
|---|---|---|---|---|---|
| B1 | One branch for several selling households | proposed | The `branch_acts_for_buyer` refusal rested on an incorrect assumption and is removed in `150000` (analysis below). Appointment now depends only on the caller, the target row and the branch; `search_ea_branch_directory` takes only the query text. Static check that the body reads no other row; model cases 16 and 21 | `150000`, `b1-assignment-error-copy-app.patch`, verifier | None for appointment. A branch representing two linked households sees both rows, which it is entitled to (own assignments) |
| B2 | Bare user ids | proposed (write and read side) | Write: `170000` guards `chains` writes; `chain_nodes` writes already pin `user_id = auth.uid()`; `operational_delays` is written only by RPCs; `160000` removes the property → homeowner id resolver. Read: full inventory below; `190000` (own nodes view), `b2-shared-chain-user-ids-app.patch`, then `200000` (column privileges). Model cases 23, 24 and 26; static checks on all three | `160000`, `170000`, `190000`, `200000`, `b2-shared-chain-user-ids-app.patch`, verifier | Not verified on a database (PostgREST column privileges, policies and RETURNING; see the Development list). Agency staff still read the represented homeowner's id on assigned rows (`ea_operational_assignments`, authorised; follow-up below). The client-side buyer-ready/sale ambiguity flag is lost for agency staff (documented dependency) |
| B3 | Existence probes | proposed | `160000`; inventory check finds no remaining user-callable not-found probe or unguarded function outside the reviewed list. Model cases 19–20 | `160000`, verifier | Lock timing before authorisation; `is_ea_branch_commercially_entitled` / `is_smoke_test_ea_branch` by branch id (low) |
| B4 | Reconnection | proposed (disabled); decision made: stays disabled for launch | `150000` stubs both RPCs. No alternate route: the only `property_ea_assignments` inserts are `assign_property_ea_branch` (seller-side homeowner), `_ea_assign_originated_property` (internal; new agent-originated rows only), `reconnect_returning_ea_branch` (stubbed) and `connect_ea_to_awaiting_property` (always `join_details_not_matched` since `20261010090000`). No update sets `status = 'active'`. Client insert and update policies were dropped in `20261005120000`. A homeowner re-appointing a former branch is a new appointment (25.30). Re-audited this revision against migrations plus proposals (verifier "B4 audit"): the only inserters are `assign_property_ea_branch` and `_ea_assign_originated_property`, whose only caller (`_create_ea_operational_property_core`) inserts a new property first; no function sets a revoked assignment back to `active`; the reconnect and connect functions change no rows. `180000` adds no reactivation | `150000`, verifier | None technical |
| B5 | "Branch Access Ended" / 25.27 revocation | proposed (in launch scope per decision) | `180000` (revocation and reconciliation functions, reason codes), `b5-branch-access-ended-notice-app.patch` (homeowner notice). Webhook and cron insertion points identified (B5 section). Model case 25; static checks; read-path check that every assignment-access path filters on `status = 'active'` | `180000`, `b5-branch-access-ended-notice-app.patch`, verifier | Not applied or wired. Up to ~24 h lag on grace expiry (daily cron). Enforcement flag is `false`; Development verifiers pin it. Decisions listed below |
| B6 | Staff granularity | confirmed (decision: all current members of the assigned branch) | `ea_branch_members.role` is `branch_admin` or `agent` (`20260610150000` check constraint); no per-staff assignment column or table. `'branch_admin'` is checked only by `is_ea_branch_admin`, `accept_ea_branch_invitation`, `remove_ea_branch_member`, `transfer_ea_branch_ownership` and `_enforce_ea_branch_owner_invariant` (team, ownership, billing callers; app: `lib/estateAgent/branchTeam.ts`, `lib/billing/eaBillingAuth.ts`, billing portal route). Every assignment-access helper (`is_ea_assigned_to_property`, `is_ea_assigned_to_chain`, `can_operate_property`, `is_ea_delegated_editor_*`, `get_property_ea_branch_entry`, `is_property_operational_participant`, delink functions) admits any current member, and the branch-scoped policies have no role check. Re-audited this revision in the verifier ("B6 audit", effective definitions across migrations and proposals). `ea_branch_members_one_branch_per_user_idx` (`20260712200000`) limits a user to one branch. Rules 17.6, 17.7, 17.13, 17.16, 25.46 | verifier | None. Notes: any member (not only `branch_admin`) reads `ea_subscription_events` for their branch; 25.46's multi-branch case cannot occur while the one-branch index exists |
| B7 | Google Doc | open (manual) | Wording in `../business-rules-ea-identity-confidentiality.md`; Google Doc unchanged | transfer doc | Rules and code diverge until transferred |
| A1 | Context strip misattribution | proposed | `a1-operational-context-strip-app.patch`; model case 22; patch checks | patch, verifier | An agent assigned to two rows in one chain sees the strip only on the row `operationalSubject` resolves |

### B1: the buyer-branch refusal

**What it did.** `assign_property_ea_branch` (`20261005120000`, kept by
`20261011090000`) refused a branch when another row in the chain had
`linked_property_id` pointing at the target row and that branch was active
on it (`branch_acts_for_buyer`). The same pattern appears in
`connect_ea_to_awaiting_property` (always refuses since `20261010090000`)
and in the two reconnection functions (stubbed by `150000`). No other
function, policy or app path has it, and the directory search does no
exclusion.

**What the link means.** Every writer of `linked_property_id`
(`link_start_move_onward_purchase`, `create_searching_placeholder_for_sale`,
`link_sale_to_searching_placeholder` (placeholder owner must equal the sale
owner), `establish_connected_hop` (host sale's seller = purchase's buyer))
points a household's **sale** at that **same household's onward
purchase**. The other writers point a row at a searching placeholder
(`establish_connected_hop`'s downstream link; Join Chain's relink of the
caller's own sale in `lib/joinChainSearching.ts`), and a placeholder can
never be appointed (`invalid_property` / `not_authorized`). `lib/resolveUpstreamPurchaser.ts` reads it the same way ("an
inbound sale already represents the buyer"). An assignment always represents
a row's seller side (`is_property_seller_side_homeowner`: the identity
holder of a sale, or the counterparty seller of a purchase;
`lib/operationalSubject.ts`: "An EA branch always acts for the seller side
of its assigned row"). There is no buyer-side assignment anywhere in the
schema.

**Conclusion.** On a purchase row PX (household X buying), the seller side is
household Y. The refused branch was the one selling X's own home SX. It
represents X as a seller, not as PX's buyer. The refusal therefore blocked
two different selling households from using the same branch, which the
product allows, and its error told Y which agent X uses. It is an incorrect
product assumption (category 2), not a security control: authorisation is
the seller-side check, eligibility is the directory check, and both are
unchanged. Its apparent purpose (not acting for both buyer and seller of one
sale) cannot be kept without inventing a buyer-side relationship from chain
position, which the clarification rules out. Business Rules 4.7 and 5.11–5.15
tie each appointment to the homeowner's own property; 5.13 already forbids
assuming one row's agent is responsible for an adjacent row.

**Change.** `150000` removes the refusal; the answer is `not_authorized`
(unknown, foreign, searching or not the seller side), `branch_not_found`
(unknown or not in the directory), or `ok`. A buyer-only tile has no seller
side until a counterparty seller joins, so nobody can attach an agent to it,
and creating, linking and connecting it never touch assignments.
`b1-assignment-error-copy-app.patch` removes the now-unreachable message.

**Confidentiality.** Each household reads only its own row's assignment
(`120000`, which must be applied first). The shared chain view reads no
assignment data. Branch staff see all their own branch's rows, including two
linked ones. Display limit, not a leak: an agent assigned to two rows in one
chain sees the chain from one of them (`pickEstateAgentAssignmentInChain`
prefers the sale); with the A1 patch the context strip shows only on that
row's page.

### B1 re-audit (this revision)

The verifier's "B1 audit" reads the effective definition of every function
(latest across migrations and proposals, including `180000`): no effective
function returns or tests `branch_acts_for_buyer`, and no effective
appointment path reads `linked_property_id` to refuse a branch. `180000`,
`190000`, `200000` and both new patches add no refusal. The correction above
stands unchanged; a buyer-only tile still needs no assignment.

### B2 read side: inventory, design and dependencies

Inventory (every shared-chain read that returns a user id; all readable by
any current chain participant through `is_chain_operational_viewer`):

| Source | User-id columns | App read | App use |
|---|---|---|---|
| `chains` | `created_by_user_id`, `completion_date_recorded_by_user_id`, `completion_date_updated_by_user_id`, `completion_confirmed_by_user_id` | `select("*")` in `context/ChainContext.tsx`; the three completion writers read back after writing | mapped to `completionDateRecordedByUserId` / `completionConfirmedByUserId`, never compared or shown |
| `chain_nodes` | `user_id` | `select('*')` in `ChainContext`; `lib/ensureBuyerReadyOnJoin.ts` (`.eq("user_id", userId)`) | `findBuyerReadyNodeForUser` (`lib/operationalPosition.ts`) and `app/buyer-ready/[chainId]/page.tsx` compare with the caller's id only |
| `operational_delays` | `created_by_user_id`, `resolved_by_user_id` | `ChainContext` select; mapped in `lib/operationalDelays.ts` | unused |
| `chain_completion_events` | `actor_user_id` | insert only | none |
| `chain_properties_participant` | `created_by_user_id` | view | already own id only (`150000`) |
| `activities.updated_by` | role label, not an id | — | — |
| RPCs | only branch-team RPCs (`get_ea_branch_team_directory`, `transfer_ea_branch_ownership`) return user ids, to the branch's own members | — | not shared-chain |

No realtime subscription reads these tables. `ChainContext`'s `members` is
always empty. `ea_operational_assignments.subject_user_id` (the represented
homeowner) is readable only by staff of the assigned branch; it is an
authorised agency operation and is kept (follow-up: replace with a boolean).

Design (no reversible or guessable substitute ids; the only id a caller
receives is their own):

1. `190000`: `chain_nodes_own` returns the caller's own nodes in chains they
   can view.
2. `b2-shared-chain-user-ids-app.patch` (7 files): `ChainContext` selects
   explicit column lists without the id columns, reads `chain_nodes_own`
   for the caller's own nodes and sets `user_id` to the caller's id on own
   nodes and `null` elsewhere, so `findBuyerReadyNodeForUser` and the
   buyer-ready page work unchanged for the caller. The delay and
   completion-lifecycle types drop the unused id fields. The three completion
   writers still write `params.userId` (guarded by `170000`) but no longer
   read the ids back. `ensureBuyerReadyOnJoin` looks up the caller's node
   through `chain_nodes_own`.
3. `200000`: column privileges remove the ids at the database.

Preserved: server-side ownership checks, joins and event attribution all
run in definer functions or under `service_role` and are unaffected by
column privileges for `authenticated`; caching keys (`chainId`) are
unchanged; agency operations use `ea_operational_assignments` and
definer RPCs.

Documented dependency: today an agent's client could notice that the
homeowner it represents also has a Buyer Ready node in the same chain and
mark the lens "ambiguous". After the change it can only see its own nodes,
so it resolves to the sale. Server authority is unchanged (every write is
re-checked by definer functions). Smallest safe alternative if the flag is
needed: a boolean column on `ea_operational_assignments`
(`subject_has_buyer_ready_node`), computed in the owner view. Not drafted.

Offline evidence: with the patch applied (scratch copy), no app read
selects, filters or orders on a revoked column; the remaining client writes
(`chains` completion updates, two `chain_nodes` updates) write but do not
filter on them, and the read-back lists exclude them (scan
`scan-b2-filters.mjs`, read-only). The only `ensureBuyerReadyOnJoin` caller
(`app/join-chain/page.tsx`) uses the browser client with the signed-in
user's id, so the `chain_nodes_own` lookup is equivalent.

To verify in Development before `200000` (not done): policies on these
tables that reference the revoked columns still admit legitimate writes
(PostgreSQL is not expected to check column privileges for columns used
only in policy expressions, but this must be observed); PostgREST
INSERT/UPDATE and the writers' explicit read-back do not touch revoked
columns; supabase-js `count` and `head` requests still work; a new column
added later fails closed.

### B5: design (proposal; enforcement in launch scope)

**Existing conventions (read, not changed).** Grace expiry is time-based: no
Stripe event fires when grace ends, and `apply_ea_branch_grace_expiry_if_due`
is called only lazily (the summary RPC and `lib/billing/eaCheckout.ts`
~line 373). The Stripe webhook (`lib/billing/eaStripeWebhook.ts`) records
subscription changes; the daily cron `app/api/cron/billing-health/route.ts`
(`0 4 * * *` in `vercel.json`) runs the billing health check and grace
reminders with the admin client. Enforcement is off:
`EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED = false`
(`lib/billing/eaBranchEntitlement.ts` line 23).

**Trigger and reconciliation.**

- Timely revocation (webhook): in `reconcileStripeSubscription`, after the
  `ea_subscription_events` insert (~lines 532–543), when the mapped state
  is ended, call
  `admin.rpc("revoke_ea_branch_access_after_entitlement_end", { p_branch_id })`;
  the same in `handleFoundingConfirmException` (~line 607). On error, throw
  so Stripe retries; the function is idempotent.
- Reconciliation (cron): in the billing-health route after
  `processEaBillingGraceReminderEmails` (line 32), call
  `admin.rpc("reconcile_ea_branch_entitlement_access")` and add its counts
  to the JSON response. This is the only trigger for grace expiry and
  catches missed webhooks.
- Both call sites guarded by `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED`.
  Switching the flag on is a release decision; ten billing verifiers
  reference the flag and must be reviewed in the same change.
- Not built: no new job, queue or schedule. App wiring is described here,
  not patched.

**Read paths removed.** Every assignment-access path filters on
`status = 'active'` (verifier check lists the only status-blind functions:
`_gdpr_prepare_subject_for_auth_deletion`, service-role, and
`is_property_creator_bootstrap_viewer`, which is not branch-based): assignments,
branch label RPC, dashboard, lifecycle, claim metadata, property rows,
delegated-editor and operational-participant helpers, delink options and
`ea_operational_assignments`. Revoked staff keep only events naming their
own branch.

**Audit.** The revoked assignment row (with `entitlement_expired`) and the
delink event are kept; revoked rows are readable only by `service_role`.
Billing detail stays in `ea_subscription_events`.

**Event audience.** The `branch_access_ended` delink event is readable by the
seller-side homeowner of that property and current members of that branch
(`120000`), and by nobody else. It is never written to `activities` and
`_notify_chain_participants_of_delink` is not called, so it is not on the
shared chain timeline and other participants are not told.

**Homeowner notice (proposed copy, in-app only).**

> **Branch Access Ended**
>
> The estate agent branch that was handling your sale no longer has access
> to this property. Your property and your place in the chain are unchanged.
> You can assign an estate agent branch below at any time.

It names no successor, no billing reason and does not suggest the
transaction ended. `b5-branch-access-ended-notice-app.patch` adds
`lib/estateAgent/branchAccessNotice.ts` (constant and loader reading the
latest branch-bearing event for the property) and shows the notice in
`components/estate-agents/PropertyEstateAgentAssignment.tsx` only while the
property has no current assignment. Rendered on the property page and the
chain page's own-property panel. **No email is sent and no email template
changes** (25.35). Branch staff see the event through existing delink-event
reads; whether they need a UI surface is a decision.

**Open decisions:** accept up to ~24 h lag on grace expiry (or run the cron
more often); branches with no subscription history are skipped and counted
(see audit A6); flag gating; branch-staff UI; whether open team invitations
for the branch should also be revoked.

### Assumptions

1. Core tables (`properties`, `chains`, `property_members`, `activities`)
   predate the migrations folder; preflights inspect the live catalog.
2. The chain-row `FOR UPDATE` lock serialises Start Move create and cleanup.
3. `_address_reservation_conflict`'s advisory lock is held to transaction end
   (harmless).
4. `email_events.chain_id` is never set by the app; checked anyway.
5. `is_property_seller_side_homeowner` is the authoritative seller-side rule.
6. Function owners are `postgres` (the `150000` preflight refuses if a helper
   and its callers have different owners).
7. Snapshots from earlier sessions are not evidence; every statement here
   is from the repository migrations and code.

### Decisions needed

1. Visibility scope: delegates and the buyer on a purchase row lose the
   assignment, claim metadata and branch-bearing events. Confirm.
2. "Authorised agency users" = current branch members (B6). **Decided**
   (all current members of the assigned branch; no new roles).
3. Reconnection disabled (B4). **Decided** (disabled for initial launch; a
   returning homeowner makes a new appointment).
4. B1 resolved by the product clarification (one branch may represent
   several selling households in a chain); no decision outstanding.
5. Branch dashboard "archived" tab shows only lifecycle-archived active
   assignments after `130000`. Confirm.
6. A former identity holder no longer reads later delink events without a
   branch (keeps their own). Confirm.
7. Labels: `estate_agent` only for the assigned branch acting where it is
   not the seller side; clients can no longer write `system`. Confirm.
8. `p_require_empty` ignored, or dropped later.
9. Empty source chains with history are kept. Confirm.
10. No rate limit on `start_move_create_property`. Confirm.
11. `address_unavailable` reuses the reserved message. Confirm.
12. Business Rules 9.13 / 19.12 patch location (`clinkit-authority-fix`).
13. Promotion updates the verifiers listed below in the same change.
14. B5: in launch scope (**decided**); reason codes `entitlement_expired`
    (assignment) and `branch_access_ended` (event) proposed because no
    existing code fits; homeowner notice in-app only (**decided**: neutral,
    homeowner only; copy above for approval). Still open: (a) accept up to
    ~24 h lag on grace expiry or run the cron more often; (b) branches with no
    subscription history are skipped, not revoked (audit A6 sizes this);
    (c) when to switch `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED` on, with
    the Development verifiers that pin it; (d) whether branch staff need a
    UI surface for the event; (e) whether open team invitations of the
    branch are revoked too.
15. B2 read side: own-nodes view plus column privileges (drafted). Confirm
    the documented dependency (agency client no longer flags the
    buyer-ready/sale ambiguity), and whether `ea_operational_assignments.subject_user_id`
    should later become a boolean.
16. `confirm_transaction_still_active` "managed" no-op now refused to
    callers who are neither the dependent side nor an operator. Confirm.
17. Any branch member (not only `branch_admin`) reads its branch's
    `ea_subscription_events`. Confirm this is intended (B6 note).
18. Business Rule 25.46 (one person in several branches) cannot occur while
    `ea_branch_members_one_branch_per_user_idx` exists. Confirm.
19. Outcome of the legacy assignment audit (task E) before launch: which
    rows, if any, are revoked, and by whom.

---

## 8. Rollout

1. `20261021100000` (additive).
2. Deploy the Start Move client (app patch).
3. `20261021110000`, **not before step 2**.
4. `20261021120000`.
5. `20261021130000` after `120000`.
6. `20261021140000` at any point (independent).
7. `20261021150000` after `130000`. Before or with it: the app keeps working
   unchanged (`branch_acts_for_buyer` is never returned, so a seller can now
   appoint the branch that sells another household's home; the reconnect
   page shows nothing). B4 should be decided first. Apply
   `b1-assignment-error-copy-app.patch` with or after it. `150000` must
   follow `120000`: before `120000`, the buyer, as a member of the purchase
   row, can read that row's assignment.
8. `20261021160000` after `150000` (its preflight requires `130000`'s
   policy change). No app change needed: authorised callers get the same
   answers, and `getNextChainPosition` already falls back to 1.
9. `20261021170000` at any point (independent).
10. `a1-operational-context-strip-app.patch` at any point (UI only).
11. Run the legacy assignment audit (task E) on Development, read-only, and
    resolve its findings before `180000` is wired.
12. `20261021180000` after `120000` (its preflight refuses otherwise). It is
    inert until called.
13. `b5-branch-access-ended-notice-app.patch` with or after `180000`
    (harmless before it: no `branch_access_ended` event can exist yet).
14. Webhook and cron wiring (B5 section) after `180000`, behind
    `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED`, with the Development
    billing verifiers updated in the same change.
15. `20261021190000` (additive) at any point.
16. Deploy `b2-shared-chain-user-ids-app.patch`, **after `190000`** (it
    reads `chain_nodes_own`).
17. `20261021200000`, **only after step 16 is live** and the Development
    checks in the B2 section pass. Before step 16, the deployed app selects
    `*` and the chain page would fail.

Each file's preflight is its first statement and raises before any change
if a policy, view or function differs from what the proposal was written
against, so a failed preflight leaves the database unchanged. Regenerate
against the live definitions instead of editing a preflight.

### Verifiers to update on promotion

- Apply `start-move-atomic-create-app.patch` (five Start Move verifiers and
  the allowlist).
- `verify-properties-chain-integrity-migration.ts`: add the six files to
  `DEPENDENT_FOLLOW_UP_MIGRATIONS`.
- `verify-ea-branch-directory-search-eligibility.ts`: move the label RPC
  checks to `20261021120000`.
- `scripts/secdef-user-rpc-allowlist.json`: add
  `is_property_creator_bootstrap_viewer(bigint)`
  (`authenticated_readonly_predicate_helper`); remove the four revoked
  helpers and add them to `scripts/secdef-service-role-only-targets.json`.
- `verify-unrestricted-views-security-development.ts` pins
  `chain_properties_participant` to `20260725140000`; point it at
  `20261021150000`.
- `verify-operational-authority-migration.ts` pins the reconnect functions in
  `20261005120000` by file; still valid for that file, but add a check that
  the latest definition is the `150000` stub.
- `160000`: `verify-lifecycle-bounded-dormancy-migration.ts` and
  `verify-operational-authority-migration.ts` check the replaced bodies in
  their source files; still valid for those files, but add a check that the
  latest definition is the `20261021160000` copy. Remove the six revoked helpers from
  `scripts/secdef-user-rpc-allowlist.json` and add them to
  `scripts/secdef-service-role-only-targets.json`. Development verifiers
  that expect `property_not_found`, `sale_not_found`, `purchase_not_found`
  or `chain_not_found` for an unauthorised caller must expect the merged
  code.
- `150000` (B1): `verify-operational-authority-migration.ts` (line ~411) and
  `verify-assign-property-ea-branch-eligibility-migration.ts` (line ~131)
  assert the refusal in `20261005120000` / `20261011090000`; still true of
  those files, but add a check that the latest definition is the `150000`
  copy without it. Apply `b1-assignment-error-copy-app.patch`.
- `180000` (B5): the ten `scripts/verify-ea-billing-*` verifiers that
  reference `EA_BILLING_ENTITLEMENT_ENFORCEMENT_ENABLED` (nine
  `*-development.ts` plus `verify-ea-billing-architecture-readonly.ts`) must
  be reviewed when the flag is switched on (not when `180000` is applied).
  Add `revoke_ea_branch_access_after_entitlement_end(uuid)` and
  `reconcile_ea_branch_entitlement_access()` to
  `scripts/secdef-service-role-only-targets.json`. Any verifier listing the
  allowed `revocation_reason` / delink `reason_code` values must include the
  new codes; `lib/ownership/participationDelinkReasonCodes.ts` must **not**
  gain `branch_access_ended` (it is not a user-selectable reason).
- `190000` / `200000` (B2): Development scripts that read `user_id` or the
  `*_by_user_id` columns of `chains`, `chain_nodes`, `operational_delays` or
  `chain_completion_events` with a user session must switch to the admin
  client or `chain_nodes_own`; `verify-unrestricted-views-security-development.ts`
  gains `chain_nodes_own` (owner view, own rows only).
- Retire `verify-prelaunch-stage2-proposals.ts` once promoted.

---

## 9. Tests

### Offline (run now)

`npx tsx scripts/verify-prelaunch-stage2-proposals.ts`: static text checks
(every replaced function is a verbatim copy of its source migration except
the listed edits; exact policy and view text; grants; preflight and
postflight content; app compatibility) plus a **model** of the predicates,
evaluated current against proposed. The model is not the database: it
proves the predicates do what the text says, not that the live catalog
matches.

Model: chain S1 (buyer's unclaimed sale, branch B2 / staff E2), S2 (H2), S5
(H5 selling to H4; branch B5 / staff E5; former branch BF / staff EF), P4
(H4's purchase row); outside: U (BF-originated, revoked), U2 (B5-originated,
invitation pending), N (H9, new), G and R (created by HX, who was removed;
G's agent BF revoked by `homeowner_left_cascade`). EO is an unrelated agent.

| # | Case | Today | Proposed |
|---|---|---|---|
| 1 | Position 2 identifies the agent at position 5 | denied | denied on every path |
| 2 | Buyer identifies the seller's agent / invite details | **allowed** | denied |
| 3 | Homeowner sees own agent | allowed | allowed |
| 4 | Agency staff manage own assignments | allowed | allowed; nothing of other branches |
| 5 | Former branch reads lifecycle, dashboard, rows, events | **allowed** | denied |
| 6 | Former branch identifies its successor | **allowed** | denied |
| 7–8 | "Branch Access Ended": affected homeowner and branch only | some others **allowed** | only those two |
| 9 | Delink-options probes | existence and invitation leak | identical empty answer |
| 10 | Generic status and labels shared | yes | yes; labels derived |
| 11 | Homeowner A identifies homeowner B | creator id **exposed** | not exposed; rows and statuses still shared |
| 12 | Agent viewing the chain identifies another agent | creator id **exposed** | not exposed; same chain view as homeowners |
| 13 | Removed homeowner / creator reads their old rows | **allowed** | denied; a new creator's bootstrap still works |
| 14 | Former branch lists / re-appoints itself | **allowed** | empty / refused |
| 15 | Unauthorised probes on assign, report, break, convert, resolve | existence and another row's delay reason **leak** | identical answers for real and missing ids |
| 16 | Seller appoints the branch that sells the buyer household's home | **refused, and told why** | appointed like any eligible branch |
| 17 | Client-supplied role or `account_type` falsifies attribution | **allowed** | derived on every path |
| 18 | Legitimate workflows (appoint, report, break, convert, resolve, dashboard, removal) | allowed | allowed |
| 19 | Unauthorised probes on confirm, create placeholder, link, hop, every delink operation, EA create, next position | real and missing ids **differ** | identical answers |
| 20 | Owners, operators and the dependent side on those functions | allowed, useful errors | same answers and errors, same order |
| 21 | B1: three selling households (X sells SX and buys PX; Y sells PX; Z sells SZ) appoint one branch; every combination of other rows' assignments; unknown, foreign, searching and authorised ids; visibility; buyer-only tile | Y refused X's branch and told so | all three appointed; the answer never varies with other rows; each household sees only its own branch; the branch sees its three rows; the buyer-only tile needs and accepts no assignment |
| 22 | A1 context strip on another property's page | agent's own branch shown as manager | strip only where its labels apply |
| 23 | Direct `chains` write attributing another user | **allowed** | caller only; creator immutable |
| 24 | Owner-id policy swap | — | equivalent for every user and property |
| 25 | B5: branches BA (ended), BB (grace expired), BS (smoke test), BN (no subscription history), BG (still in grace) | nothing revokes access | BA and BB lose every read path; BS, BN, BG untouched; second run changes nothing; webhook then cron does not double-revoke; recovery or resubscription restores nothing automatically (new appointment needed); event visible to the homeowner and that branch only, never on the timeline; notice hidden after a new appointment |
| 26 | B2: users A and B (two homeowners in one chain), Z (unrelated chain), S (agency staff), R (removed participant), X (unknown id) | A, B and S read each other's user ids and can correlate them across chains | each reads only their own id; Z and R read nothing; unknown ids reveal nothing; S keeps the represented homeowner via the assignment view; documented ambiguity dependency |

Static checks also cover `160000` (verbatim copies, order, ACL, helper
callers, policy equivalence), an inventory of every user-callable function
across migrations and proposals (non-vacuous: it finds the six probes and
seven unguarded functions before `160000` and none after), `170000`, and
the A1 patch (only the visibility lines change; not applied).

Added in this revision:

- **B1 / B4 / B6 audits** over the effective definitions (latest across
  migrations and proposals, drops and creates in file order): no
  `branch_acts_for_buyer` or linked-property refusal; only two assignment
  inserters, no reactivation; assignment-access helpers have no role check,
  team-admin functions check `branch_admin`, the role constraint and
  one-branch index are as stated.
- **`180000`**: structure, preflight requires `120000`, grants, lock and skip
  order, update and insert shape, invitations, untouched objects, counts-only
  return, both reason-code lists equal the source constraints plus the new
  code, the app delink reason list does not gain `branch_access_ended`, the
  only status-blind assignment readers.
- **`190000` / `200000` / B2 patch**: view predicates and grants; one column
  list used in preflight, change and postflight; the patch adds no id
  column, `select('*')` or `user_id` filter; writers still write
  `params.userId`; not applied.
- **B5 patch**: copy (no billing, successor or "ended transaction"
  wording), shown only without a current assignment, no email or template
  file; not applied.
- **Mutation check** (scratch copy only, `%TEMP%\mlpre\mutate.mjs`): nine
  deliberate faults, each caught by at least one FAIL: timeline broadcast
  added to `180000`; entitlement check removed; reason code swapped on the
  event; execute granted to `authenticated`; branch id in the return; billing
  wording in the notice; `190000` view without the chain-viewer predicate;
  `200000` column lists drifting; an id column re-added in the B2 patch.

### Database (Development) — only after separate approval; none run

Apply to Development only with explicit approval; never Production.

| Verifier | Change needed |
|---|---|
| `verify-operational-authority-rls-development.ts` (OA1 expects `branch_acts_for_buyer`) | expect `ok`, with both households' assignments active on the same branch; add: neither household can read the other's assignment or branch label; add derived labels on report / resolve / break / convert; add unknown vs foreign id probes |
| `verify-awaiting-connection-development.ts` (AW10), `verify-start-move-onward-purchase-link-development.ts` (line ~496) | expect `ok` and two active assignments for the branch; add the visibility checks above |
| `verify-ea-reconnection-development.ts` | rewrite for fail-closed reconnection (only if B4 is approved) |
| `verify-unrestricted-views-security-development.ts` | point at `150000`; add: chain viewer sees `created_by_user_id` null for other rows, own id for own rows |
| `verify-activity-visibility-development.ts` | add: homeowner inserts `estate_agent` / `system` → stored `homeowner`; assigned agent → `estate_agent`; `account_type` change has no effect |
| `verify-ea-branch-directory-eligibility-development.ts` | add buyer, position 2, other agent on the chain, former branch |
| `verify-participation-delink.ts` | add unrelated caller probing real and unknown ids |
| `verify-ea-branch-access-dev-integration.ts` | former branch sees no revoked dashboard rows |
| `verify-cleanup-abandoned-onboarding-chain-authz-development.ts` | CASE 3 expects `chain_not_empty` |
| `verify-secdef-execute-grants.mjs` | allowlist and service-role targets above |

New database cases (real users, not admin): homeowner A vs B; agent vs agent
on the same chain; buyer vs seller's agent; position 2 vs position 5; own
agent; branch staff; former branch and its successor; removed creator;
unauthorised probes on every RPC above; "Branch Access Ended" visibility
(homeowner and that branch only; not in `activities`); generic statuses
still visible to every current participant.

B5 (after `180000`, with a test branch and admin-created fixtures): call
the revoke function twice (second call changes nothing); check every read
path for the former staff (assignments, label RPC, dashboard, lifecycle,
claim metadata, property rows, `ea_operational_assignments`, delink options);
check the homeowner and chain participants keep their access; check no
`activities` row and no notification; check `authenticated` cannot execute
either function.

B2 (after `190000`, the app patch and `200000`): two homeowners in one
chain and a user in another chain each read only their own ids; chain page,
buyer-ready page, Join Chain buyer-ready creation, completion record, amend
and confirm all still work; agency staff dashboards unchanged; anon has no
access.

---

## 10. Legacy assignment audit plan (task E; read-only, not run)

`legacy-assignment-audit.development-readonly.sql`, for the **Development**
project only, by an operator after approval. It opens
`begin transaction read only` and ends with `rollback`, and outputs ids,
codes, booleans and counts only (no names, emails, addresses or raw user
ids). It checks every active assignment against the current seller-side
rules, so the result does not depend on when `20261005110000` reached
Development.

Tables and columns: `property_ea_assignments` (`id, property_id, branch_id,
status, assigned_by_user_id, created_at`), `properties` (`id, chain_id,
relationship_type`), `property_operational_identities` (`property_id,
homeowner_user_id, status`), `property_counterparty_participants`
(`property_id, user_id, counterparty_role, status`),
`property_claim_metadata` (`property_id, origin_type, claim_status`),
`property_claim_invitations` (`id, property_id, created_by_user_id,
invitation_revoked_at, invitation_used_at, invitation_expires_at`),
`ea_branch_members` (`branch_id, user_id`), `ea_branch_subscriptions`
(`branch_id`). Functions (stable, no writes):
`_property_seller_side_user_id`, `is_ea_branch_commercially_entitled`,
`is_smoke_test_ea_branch`. All filters are `status = 'active'` on
assignments.

| Query | Finds | Expected |
|---|---|---|
| A0 | active assignments by `relationship_type`, oldest and newest | context only |
| A1 | row is neither `sale` nor `purchase` | 0 rows |
| A2 | row has no seller side today | only `estate_agent_unclaimed` (awaiting connection, 25.31) |
| A3 | appointer is neither today's seller side nor a member of the branch; classified `seller_side_changed` / `never_seller_side`, with `appointer_was_buyer` | 0 rows |
| A4 | purchase row without exactly one active counterparty seller | 0 rows |
| A5 | more than one active assignment per property | 0 rows |
| A6 | per branch: `entitled`, `has_subscription_row`, `smoke_test_fixture` | entitled or smoke-test; others are what `180000` would revoke or skip |
| A7 | open, unexpired claim invitations not backed by the assigned branch | 0 rows |

Any non-expected row is a decision for the product owner (revoke with a
reviewed migration, or keep with a recorded reason). The audit changes
nothing.

---

## Operational gap: branch with no Owner record

There is no in-product or documented recovery for an Estate Agent branch whose
Owner member record is missing (as opposed to an Owner who exists but cannot
sign in). `docs/EA_BRANCH_OWNER_SUPPORT_RUNBOOK.md` is a draft for the
inaccessible-sole-Owner case only and relies on internal support; there is no
public support channel. This pack does not invent one. An owner of this gap
and a procedure are needed before launch.
