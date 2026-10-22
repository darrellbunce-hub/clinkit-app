# Business Rules — identity confidentiality: Google Doc transfer

Status: **proposed wording only.** The Google Doc is the authoritative
source and has **not** been changed. Copy the seven blocks below into the
Google Doc by hand, then bring the repository copy into line with it.

Numbering is unchanged. Sections 1, 2, 6 and 7 add paragraphs to 3.4, 9.8,
24.7 and 4.7; section 3 is the full text of new rule 19.23; sections 4 and 5
replace wording in 25.27 and 25.35 so that they agree with 19.23.

The repository copy at `C:\projects\clinkit-authority-fix\docs\business-rules.md`
holds an earlier version of this wording and was **not** edited in this
revision. Differences from that copy are listed at the end.

---

## 1. Rule 3.4 — add after the existing two sentences

Existing text (unchanged): "A homeowner and EA must never see the EA
representing another chain member. This information is strictly
confidential."

Add as a new paragraph:

> Identity and assignment information is confidential. Chain participants must not see another homeowner's name, identity or contact details, or discover the Estate Agent, branch or agency representing another participant, that agent's assignment details, or information from which any of these could be inferred. Homeowners and Estate Agents in a chain see the same shared operational chain information (9.8); neither sees another participant's confidential identity or assignment information. Being a buyer, a property member, a former participant or a participant in the same chain does not grant that permission, and MoveLoop provides no request, consent or permission process through which one participant can obtain another participant's confidential identity or assignment information. Generic participant-type labels such as "Homeowner" or "Estate Agent" are not identity information. Confidentiality must be enforced in the interface, server and API responses, RPCs and database access policies. See 19.23.

## 2. Rule 9.8 — add after the existing sentence

Existing text (unchanged): "Chain visibility and operational authority are
separate concepts …"

Add as a new paragraph (body text, not a heading):

> Shared operational chain information includes property statuses, operational progress, timeline updates and generic actor labels such as "Homeowner" or "Estate Agent", which identify the type of participant who made an update and not the person. Homeowners and Estate Agents in the chain see the same shared operational chain information. It does not include confidential identity and assignment information: another homeowner's name, identity or contact details; another participant's Estate Agent name, branch or agency identity, or assignment details; or private branch-access events such as "Branch Access Ended". Confidential identity and assignment information is governed by 3.4 and 19.23, not by this rule. The generic label attached to an update is determined by MoveLoop from the user's authority on the property and cannot be chosen by the user.

## 3. New rule 19.23 — add after 19.22

> **19.23 Estate Agent Identity Confidentiality**
>
> Estate Agent identity is confidential identity and assignment information under 3.4. It includes the name of the Estate Agent, branch or agency representing a participant, branch or agency identifiers, assignment details, and any equivalent information from which that identity could be inferred.
>
> All participants in a chain, homeowners and Estate Agents alike, see the same shared operational chain information under 9.8. An Estate Agent viewing a chain must not be able to identify another participant's Estate Agent, branch or agency, or another homeowner.
>
> A homeowner may see the Estate Agent explicitly assigned to represent them for their own sale, subject to the established permissions. Appropriately authorised users of an Estate Agent agency may manage that agency's own authorised assignments in the agency's own workspace, in accordance with 17.7, 17.13 and 17.16. That workspace must not disclose other agents, branches or agencies acting in the same chain. No other user may see a participant's Estate Agent identity through MoveLoop.
>
> Being a buyer, a property member or a participant in the same chain, owning another property in that chain, occupying a particular chain position, having created the property record, having previously participated, or being able to view shared operational chain information under 9.8 does not grant permission to see or discover another participant's Estate Agent identity or another homeowner's identity. For example, a participant at position 2 must not be able to identify the Estate Agent representing the seller at position 5, a buyer must not be able to identify the Estate Agent representing the seller of the property they are buying, and an Estate Agent acting in the chain must not be able to identify another Estate Agent acting in it.
>
> There are no exceptions. MoveLoop must not provide any request, consent or permission process through which one participant can obtain another participant's confidential identity or assignment information.
>
> Generic status attribution is not identity disclosure. All users in a chain may see shared property statuses, operational progress, timeline updates and generic actor labels such as "Homeowner" or "Estate Agent". These labels identify the type of participant who made an update, not the person, branch or agency, and are intentionally shared. They must not include, or be combined with, information that identifies the person, branch or agency.
>
> "Branch Access Ended" is not shared chain information and must not appear in the shared chain timeline. It may be shown only to the homeowner directly affected (the homeowner the branch represented for that property) and to appropriately authorised users of the affected agency. Other chain participants, including buyers, property members, participants at other chain positions and any branch that later represents the homeowner, must not see it.
>
> A generic "Estate Agent Connected" marker on a property is optional and is not a launch requirement. If implemented, it must not identify the agent, branch or agency.
>
> MoveLoop must not disclose another participant's Estate Agent identity, branch identity, assignment details, or information that enables that identity to be inferred, through its interface, server and API responses, RPCs, database access policies, search results, error messages or other product functionality. Responses to a user who has no authority over a property, chain or invitation must not reveal whether that property, chain or invitation exists, or anything about it such as its size or state.
>
> Users must follow the established communication route for their own property. MoveLoop must not facilitate contacting another party's Estate Agent merely because that party is connected through the same chain.
>
> This rule applies to direct database and API access as well as to visible interface elements. Hiding an agent's identity in the interface is insufficient if an unauthorised participant can retrieve it elsewhere in the application (see 11.2 and 11.3).

---

## 4. Rule 25.27 — replace one phrase

Replace:

> create the approved neutral system/timeline notice using the wording Branch Access Ended. Billing reasons must remain confidential.

with:

> create the approved neutral notice using the wording Branch Access Ended. That notice is visible only to the homeowner directly affected and to appropriately authorised users of the affected agency (19.23); it must not be added to the shared chain timeline. Billing reasons must remain confidential.

## 5. Rule 25.35 — replace the first sentence

Replace:

> For the initial launch, loss of EA access should generate the existing neutral system/timeline notice rather than introducing a separate email notification system.

with:

> For the initial launch, loss of EA access should generate the neutral in-product notice described in 25.27, visible only to the homeowner directly affected and to appropriately authorised users of the affected agency (19.23) and not to other chain participants, rather than introducing a separate email notification system.

The second sentence ("A more prominent in-product notification or email may
be considered as a later enhancement.") is unchanged.

## 6. Rule 24.7 — add after the existing paragraph

Existing text (unchanged): "When an Estate Agent branch's authority ends,
the former branch must no longer have operational access to identifiable
property or homeowner information solely because it previously managed the
property. MoveLoop may retain the minimum records required …"

Add as a new paragraph:

> Retaining a record does not permit reading it. A former branch must not be able to list, search for or reconnect itself to a property it previously managed, or identify the branch that replaced it. A new Estate Agent relationship for the property may be created only by the homeowner's appointment (7.8). The same applies to a homeowner or other participant whose involvement has ended: having created the property record or having previously participated does not grant continued access to identifiable property information.

## 7. Rule 4.7 — add after the existing sentence

Existing text (unchanged): "A homeowner may appoint an EA to represent them
for their property."

Add as a new paragraph:

> An Estate Agent appointment represents a household's sale. A property the household is only buying does not need an Estate Agent appointment, and the buyer cannot appoint one to it. Different households selling different properties in the same chain may appoint the same Estate Agent branch; each appointment is authorised on its own, and the same branch representing several selling households is not, by itself, a reason to refuse an appointment. MoveLoop must not infer that an Estate Agent acts for a buyer from chain position, buyer status or a buyer-only property, and must not refuse or accept an appointment in a way that reveals whether another household uses that branch (3.4, 19.23).

---

## Differences from the `clinkit-authority-fix` repository copy

That copy has the previous version of sections 1–5 and nothing for sections
6 and 7.

| Rule | Change in this version |
|---|---|
| 3.4 | adds contact details, inference, "former participant", the same shared view for homeowners and Estate Agents, and "no request, consent or permission process" |
| 9.8 | adds the same shared view for homeowners and Estate Agents, "contact details", "private branch-access events", and that MoveLoop determines the label. In the repository copy the 9.8 paragraph is formatted as a `###` heading (line 610); it should be body text |
| 19.23 | adds the "same shared view" paragraph, the agency-workspace wording, "having created the property record, having previously participated", the agent-to-agent example, the "no exceptions" paragraph, error messages and existence probes; the "Branch Access Ended" audience becomes "the homeowner directly affected" and "authorised users of the affected agency", and excludes a later branch |
| 25.27, 25.35 | audience wording aligned with 19.23 ("homeowner directly affected", "authorised users of the affected agency") |
| 24.7 | new paragraph (section 6) |
| 4.7 | new paragraph (section 7): appointments represent a household's sale; several selling households may use one branch |

## Decisions recorded (no change to the seven blocks)

The product owner has decided the following. The seven blocks above already
agree with them, so none is changed.

- **B6:** "Appropriately authorised users of the affected agency" means all
  current members of the assigned branch. No new roles or per-staff
  assignment (19.23 wording unchanged).
- **B4:** returning-branch reconnection stays disabled for initial launch; a
  returning homeowner makes a new appointment under the existing rules
  (section 6, 24.7: "only by the homeowner's appointment (7.8)").
- **4.7 / B1:** section 7 already states the decision: an appointment
  represents a household's own sale; a buyer-only tile needs none; several
  selling households may appoint the same branch; the shared view must not
  reveal another household's agent (3.4, 19.23).
- **B5:** entitlement enforcement is in launch scope. The audience in
  sections 4 and 5 (25.27, 25.35) is what the Stage 2 proposal enforces.
  The proposed in-product notice copy is in the Stage 2 README (B5 section);
  no email (25.35).
- **B2:** relies on 3.4 ("information from which any of these could be
  inferred") and 19.23; no new wording needed.

## Still for the product owner

- 4.7 (section 7): confirm the wording, including "the buyer cannot appoint
  one to it" (a buyer-only property has no seller side, so nobody can
  appoint to it; this is not the removed buyer-branch refusal).
- 25.27 / 25.33: approve the "Branch Access Ended" notice copy in the Stage 2
  README. Whether branch staff need a visible notice in the product, and
  whether up to about 24 hours' delay after grace ends is acceptable, are
  open (README decision 14).
- 25.46: one person in several branches cannot occur today (one-branch
  index). Confirm, or the rule needs a note.
