import {
  formatEaBranchMemberRoleLabel,
  formatEaBranchMemberStatusLabel,
  getEaBranchMemberStatusClasses,
} from "../lib/estateAgent/branchTeamPresentation";
import {
  formatEaBranchInvitationError,
  formatEaBranchTeamLoadError,
  mapInviteRoleOptionToDbRole,
  buildEaBranchInvitationUrl,
} from "../lib/estateAgent/branchTeam";
import { ROUTES } from "../lib/auth/routes";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testRoleMapping() {
  assert(
    mapInviteRoleOptionToDbRole("staff") === "agent",
    "staff maps to agent"
  );
  assert(
    formatEaBranchMemberRoleLabel("branch_admin") ===
      "Owner",
    "branch_admin displays as Owner"
  );
  assert(
    formatEaBranchMemberRoleLabel("agent") === "Staff",
    "agent displays as Staff"
  );
}

function testStatusPresentation() {
  assert(
    formatEaBranchMemberStatusLabel("active") ===
      "Active",
    "active status label"
  );
  assert(
    formatEaBranchMemberStatusLabel("pending") ===
      "Pending Invitation",
    "pending status label"
  );
  assert(
    getEaBranchMemberStatusClasses("active").includes(
      "status-success"
    ),
    "active status classes"
  );
}

function testInvitationUrl() {
  const url = buildEaBranchInvitationUrl(
    "sample-token",
    "https://app.keynetic.test"
  );

  assert(
    url ===
      `https://app.keynetic.test${ROUTES.estateAgentJoin}?token=sample-token`,
    "invitation url uses join route"
  );
}

function testErrorSurfacing() {
  assert(
    formatEaBranchInvitationError("not_branch_member", {
      includeTechnicalDetail: true,
    }).includes("not_branch_member"),
    "explicit technical detail includes rpc code"
  );

  assert(
    formatEaBranchInvitationError("not_branch_member").includes(
      "branch membership"
    ),
    "friendly message for not_branch_member"
  );

  assert(
    formatEaBranchInvitationError(
      "owner_invitation_not_allowed"
    ).includes("Staff"),
    "owner invitation blocked message"
  );
}

function main() {
  testRoleMapping();
  testStatusPresentation();
  testInvitationUrl();
  testErrorSurfacing();

  console.log("verify-ea-branch-team: 4/4 passed");
}

main();
