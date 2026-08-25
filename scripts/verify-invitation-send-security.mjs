/**
 * Static verification for invitation email send hardening.
 */
import { readFileSync } from "fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(path) {
  return readFileSync(path, "utf8");
}

function main() {
  const homeownerRoute = read(
    "app/api/communications/homeowner-invitation/route.ts"
  );
  const eaRoute = read(
    "app/api/communications/estate-agent-invitation/route.ts"
  );
  const homeownerPanel = read(
    "components/agent/commandCentre/HomeownerInvitationPanel.tsx"
  );
  const inviteDialog = read(
    "components/account/InviteTeamMemberDialog.tsx"
  );
  const migration = read(
    "supabase/migrations/20260713010000_harden_invitation_email_send.sql"
  );
  const sendSecurity = read("lib/communications/invitationSendSecurity.ts");

  assert(
    sendSecurity.includes('["queued", "sent"]'),
    "idempotency must only consider queued or sent email events"
  );

  assert(
    !homeownerRoute.includes("claimUrl") &&
      !homeownerRoute.includes("body.expiresAt") &&
      homeownerRoute.includes("invitationToken") &&
      homeownerRoute.includes("buildServerClaimInvitationUrl") &&
      homeownerRoute.includes("validateHomeownerInvitationForEmailSend") &&
      homeownerRoute.includes("evaluateInvitationSendGuards"),
    "homeowner invitation route must derive URLs server-side"
  );

  assert(
    !eaRoute.includes("body.invitationLink") &&
      eaRoute.includes("invitationToken") &&
      eaRoute.includes("buildServerEaBranchInvitationUrl") &&
      eaRoute.includes("validateEaBranchInvitationForEmailSend"),
    "estate agent invitation route must derive URLs server-side"
  );

  assert(
    !homeownerPanel.includes("claimUrl:") &&
      homeownerPanel.includes("invitationToken: token"),
    "homeowner panel must not send claimUrl to API"
  );

  assert(
    !inviteDialog.includes("invitationLink") &&
      inviteDialog.includes("invitationToken: invitationResult.token"),
    "team invite dialog must not send invitationLink to API"
  );

  assert(
    migration.includes(
      "validate_property_claim_invitation_for_email_send"
    ) &&
      migration.includes(
        "validate_ea_branch_invitation_for_email_send"
      ),
    "validation RPC migration must exist"
  );

  console.log("verify-invitation-send-security: all checks passed");
}

main();
