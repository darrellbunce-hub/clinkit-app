import { readFileSync } from "fs";
import { join } from "path";

import {
  formatEaBranchInvitationError,
  mapInviteRoleOptionToDbRole,
  type EaBranchOwnershipOutgoingAction,
} from "../lib/estateAgent/branchTeam";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testStaffOnlyInvitations() {
  assert(
    mapInviteRoleOptionToDbRole("staff") === "agent",
    "invitations map to agent only"
  );
}

function testTransferErrorMessages() {
  const cases = [
    "owner_invitation_not_allowed",
    "cannot_transfer_to_self",
    "target_must_be_staff",
    "owner_invariant_violation",
  ] as const;

  for (const code of cases) {
    const message = formatEaBranchInvitationError(code);
    assert(
      !message.includes(code),
      `${code} should have friendly message`
    );
  }
}

function testOutgoingActionUnion() {
  const remain: EaBranchOwnershipOutgoingAction =
    "remain_staff";
  const leave: EaBranchOwnershipOutgoingAction =
    "leave_branch";
  assert(remain === "remain_staff", "remain_staff literal");
  assert(leave === "leave_branch", "leave_branch literal");
}

function testMigrationSecurityControls() {
  const migrationPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260721100000_ea_branch_access_ownership_continuity.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert(
    sql.includes("revoke update on public.ea_branch_members from authenticated"),
    "authenticated UPDATE revoked on ea_branch_members"
  );
  assert(
    sql.includes("drop policy if exists ea_branch_members_update_admins"),
    "direct role UPDATE policy dropped"
  );
  assert(
    sql.includes("create or replace function public.transfer_ea_branch_ownership"),
    "ownership transfer RPC present"
  );
  assert(
    sql.includes("ea_branch_owner_invariant_trigger"),
    "deferred one-Owner invariant trigger present"
  );
  assert(
    sql.includes("owner_invitation_not_allowed"),
    "Owner invitations blocked in RPCs"
  );
  assert(
    sql.includes(
      "select public.is_ea_branch_admin(p_branch_id);"
    ) &&
      !sql.includes(
        "or public.is_ea_branch_founder(p_branch_id);"
      ),
    "founder bypass removed from team manager helper"
  );
  assert(
    sql.includes("pg_advisory_xact_lock"),
    "ownership transfer uses advisory lock"
  );
  assert(
    sql.includes("create table if not exists public.ea_branch_membership_events"),
    "membership audit table present"
  );
}

function testLifecycleFixMigration() {
  const migrationPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260721110000_ea_branch_owner_invariant_lifecycle_fix.sql"
  );
  const sql = readFileSync(migrationPath, "utf8");

  assert(
    sql.includes("from public.ea_branches b"),
    "invariant trigger skips deleted branches"
  );
  assert(
    sql.includes("'owner_left_branch'") &&
      sql.includes("set role = 'agent'") &&
      sql.includes("delete from public.ea_branch_members"),
    "leave_branch demotes outgoing Owner before DELETE"
  );
}

function main() {
  testStaffOnlyInvitations();
  testTransferErrorMessages();
  testOutgoingActionUnion();
  testMigrationSecurityControls();
  testLifecycleFixMigration();

  console.log("verify-ea-branch-access-revocation: 5/5 passed");
}

main();
