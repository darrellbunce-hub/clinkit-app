/**
 * Development-only integration verification for EA branch access / ownership continuity.
 *
 * Requires migrations 20260721100000 and 20260721110000 applied on Development (bbbsxzxcjkmpqsfvmhbo).
 *
 * Usage:
 *   npx tsx scripts/verify-ea-branch-access-dev-integration.ts
 *   npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute
 *   npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute --cleanup-stale
 *
 * Default (no --execute): read-only preflight — migration presence + environment checks.
 * --execute: creates isolated test EA users/branches, runs security scenarios, cleans up.
 * --cleanup-stale: also remove orphaned fixtures from prior failed runs (ea-access-dev-* only).
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { completeEstateAgentOnboarding } from "../lib/estateAgent/completeOnboarding";
import { createEstateAgentProfile } from "../lib/estateAgent/createEstateAgentProfile";

const DEVELOPMENT_SUPABASE_PROJECT_REF = "bbbsxzxcjkmpqsfvmhbo";
const PASSWORD = "EaAccessDev123!";
const TEST_EMAIL_LOCAL_PREFIX = "ea-access-dev";
const LEGACY_TEST_EMAIL_DOMAIN = "keynetic-test.dev";

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

type TestRunFixture = {
  stamp: string;
  primaryDomain: string;
  secondaryDomain: string;
};

type TrackedTestUser = {
  userId: string;
  email: string;
};

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(pass ? `✓ ${name}` : `✗ ${name}${detail ? `: ${detail}` : ""}`);
}

function loadEnvLocal(): void {
  const envPath = join(process.cwd(), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function resolveServiceRoleKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (
    value === "your-service-role-key" ||
    value === "your_service_role_key"
  ) {
    return undefined;
  }
  return value;
}

function assertDevelopmentEnvironment(supabaseUrl: string): void {
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  const projectRef = match?.[1] ?? null;
  if (projectRef !== DEVELOPMENT_SUPABASE_PROJECT_REF) {
    throw new Error(
      `Refusing to run: Supabase project "${projectRef ?? "unknown"}" is not Development.`
    );
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run: VERCEL_ENV=production.");
  }
}

function createFixture(stamp: string): TestRunFixture {
  return {
    stamp,
    primaryDomain: `ea-access-dev-${stamp}.test`,
    secondaryDomain: `ea-access-dev-${stamp}-b.test`,
  };
}

function buildTestEmail(
  fixture: TestRunFixture,
  label: string,
  domain: "primary" | "secondary"
): string {
  const emailDomain =
    domain === "primary"
      ? fixture.primaryDomain
      : fixture.secondaryDomain;
  return `${TEST_EMAIL_LOCAL_PREFIX}-${label}-${fixture.stamp}@${emailDomain}`;
}

function isIntegrationTestEmail(email: string | undefined): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  if (!normalized.startsWith(`${TEST_EMAIL_LOCAL_PREFIX}-`)) {
    return false;
  }
  return (
    normalized.endsWith(`.test`) ||
    normalized.endsWith(`@${LEGACY_TEST_EMAIL_DOMAIN}`)
  );
}

function emailBelongsToFixtureRun(
  email: string,
  fixture: TestRunFixture
): boolean {
  const normalized = email.toLowerCase();
  return (
    normalized.endsWith(`@${fixture.primaryDomain}`) ||
    normalized.endsWith(`@${fixture.secondaryDomain}`) ||
    normalized.endsWith(
      `@${LEGACY_TEST_EMAIL_DOMAIN}`
    ) && normalized.includes(`-${fixture.stamp}@`)
  );
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const serviceRoleKey = resolveServiceRoleKey(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function serviceClient(): SupabaseClient {
  return createClient(url!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listAllAuthUsers(admin: SupabaseClient) {
  const users: Array<{ id: string; email?: string }> = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(
      ...(data.users?.map((user) => ({
        id: user.id,
        email: user.email ?? undefined,
      })) ?? [])
    );
    if ((data.users?.length ?? 0) < perPage) break;
    page += 1;
  }

  return users;
}

async function deleteBranchFixtureData(
  admin: SupabaseClient,
  branchId: string,
  deletedBranches: Set<string>
): Promise<string[]> {
  const warnings: string[] = [];
  if (deletedBranches.has(branchId)) {
    return warnings;
  }

  const { error: eventsError } = await admin
    .from("ea_branch_membership_events")
    .delete()
    .eq("branch_id", branchId);
  if (eventsError) {
    warnings.push(`membership_events branch ${branchId}: ${eventsError.message}`);
  }

  const { error: invitationsError } = await admin
    .from("ea_branch_invitations")
    .delete()
    .eq("branch_id", branchId);
  if (invitationsError) {
    warnings.push(`invitations branch ${branchId}: ${invitationsError.message}`);
  }

  const { error: branchError } = await admin
    .from("ea_branches")
    .delete()
    .eq("id", branchId);
  if (branchError) {
    warnings.push(`branch ${branchId}: ${branchError.message}`);
  } else {
    deletedBranches.add(branchId);
  }

  return warnings;
}

async function deleteUserFixtureData(
  admin: SupabaseClient,
  userId: string,
  deletedBranches: Set<string>,
  deletedCompanies: Set<string>
): Promise<string[]> {
  const warnings: string[] = [];

  const { data: memberships } = await admin
    .from("ea_branch_members")
    .select("branch_id")
    .eq("user_id", userId);

  const branchIds = [
    ...new Set((memberships ?? []).map((row) => row.branch_id as string)),
  ];

  for (const branchId of branchIds) {
    warnings.push(
      ...(await deleteBranchFixtureData(admin, branchId, deletedBranches))
    );
  }

  const { data: companies } = await admin
    .from("ea_companies")
    .select("id")
    .eq("created_by_user_id", userId);

  for (const company of companies ?? []) {
    if (deletedCompanies.has(company.id)) {
      continue;
    }

    const { error } = await admin
      .from("ea_companies")
      .delete()
      .eq("id", company.id);
    if (error) {
      warnings.push(`company ${company.id}: ${error.message}`);
    } else {
      deletedCompanies.add(company.id);
    }
  }

  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (profileError) {
    warnings.push(`profile ${userId}: ${profileError.message}`);
  }

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    warnings.push(`auth user ${userId}: ${authError.message}`);
  }

  return warnings;
}

async function cleanupFixtureUsers(
  admin: SupabaseClient,
  options: {
    fixture?: TestRunFixture;
    includeLegacyKeyneticTestDev?: boolean;
    onlyStamp?: string;
  }
): Promise<{ removed: number; warnings: string[] }> {
  const warnings: string[] = [];
  let removed = 0;

  const users = await listAllAuthUsers(admin);
  const targets = users.filter((user) => {
    if (!isIntegrationTestEmail(user.email)) return false;
    if (options.onlyStamp && user.email) {
      return user.email.includes(`-${options.onlyStamp}@`);
    }
    if (options.fixture && user.email) {
      return emailBelongsToFixtureRun(user.email, options.fixture);
    }
    if (options.includeLegacyKeyneticTestDev && user.email) {
      return user.email.endsWith(`@${LEGACY_TEST_EMAIL_DOMAIN}`);
    }
    return false;
  });

  const deletedBranches = new Set<string>();
  const deletedCompanies = new Set<string>();

  for (const user of targets) {
    const userWarnings = await deleteUserFixtureData(
      admin,
      user.id,
      deletedBranches,
      deletedCompanies
    );
    warnings.push(...userWarnings);
    removed += 1;
  }

  return { removed, warnings };
}

async function signUpEaAgent(
  fixture: TestRunFixture,
  label: string,
  domain: "primary" | "secondary"
): Promise<TrackedTestUser & { client: SupabaseClient }> {
  const email = buildTestEmail(fixture, label, domain);
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signUpResult = await client.auth.signUp({
    email,
    password: PASSWORD,
  });

  if (signUpResult.error) {
    const signInResult = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signInResult.error) {
      throw signInResult.error;
    }
  }

  const userId = (await client.auth.getUser()).data.user?.id;
  if (!userId) {
    throw new Error("signup_missing_user");
  }

  const profileResult = await createEstateAgentProfile(client, {
    userId,
    contactName: `EA Access ${label}`,
    email,
  });
  if (profileResult.error) {
    throw new Error(profileResult.error);
  }

  return { client, userId, email };
}

async function onboardOwner(
  client: SupabaseClient,
  userId: string,
  fixture: TestRunFixture,
  domain: "primary" | "secondary",
  companySuffix = ""
) {
  const emailDomain =
    domain === "primary"
      ? fixture.primaryDomain
      : fixture.secondaryDomain;

  const result = await completeEstateAgentOnboarding(client, {
    userId,
    companyName: `EA Access Test Co ${fixture.stamp}${companySuffix}`,
    branchName: `Test Branch ${fixture.stamp}${companySuffix}`,
    townOrCity: "Fareham",
    postcode: "PO16 7AA",
    isHeadOffice: true,
    emailDomain,
  });
  if (!result.success) {
    throw new Error(result.error);
  }

  const { data: membership } = await client
    .from("ea_branch_members")
    .select("branch_id, id, role")
    .eq("user_id", userId)
    .single();

  if (!membership?.branch_id) {
    throw new Error("owner_membership_missing");
  }

  return {
    branchId: membership.branch_id as string,
    ownerMemberId: membership.id as string,
  };
}

async function migrationPreflight(admin: SupabaseClient): Promise<boolean> {
  const auditTable = await admin
    .from("ea_branch_membership_events")
    .select("id", { count: "exact", head: true });
  if (auditTable.error?.code === "42P01") {
    record("Migration applied: audit table", false, "ea_branch_membership_events missing");
    return false;
  }
  record("Migration applied: audit table", true);

  const { error: transferProbe } = await admin.rpc(
    "transfer_ea_branch_ownership",
    {
      p_branch_id: randomUUID(),
      p_new_owner_member_id: randomUUID(),
      p_outgoing_action: "remain_staff",
    }
  );
  const transferExists = !transferProbe?.message?.includes(
    "Could not find the function"
  );
  record(
    "Migration applied: transfer_ea_branch_ownership RPC",
    transferExists,
    transferExists ? undefined : transferProbe?.message
  );

  return transferExists;
}

async function countOwners(admin: SupabaseClient, branchId: string) {
  const { count, error } = await admin
    .from("ea_branch_members")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .eq("role", "branch_admin");
  if (error) throw error;
  return count ?? 0;
}

function formatRpcFailure(
  label: string,
  data: { ok?: boolean; error?: string } | null,
  error: { code?: string; message?: string } | null
): string {
  const parts = [label];
  if (data?.error) {
    parts.push(`data.error=${data.error}`);
  }
  if (error?.code) {
    parts.push(`rpc.code=${error.code}`);
  }
  if (error?.message) {
    parts.push(`rpc.message=${error.message}`);
  }
  if (!data?.error && !error?.message) {
    parts.push("no RPC error detail returned");
  }
  return parts.join("; ");
}

async function describeLeaveTransferState(
  admin: SupabaseClient,
  branchId: string,
  outgoingOwnerUserId: string,
  incomingOwnerUserId: string,
  outgoingAction: string
): Promise<string> {
  const ownerCount = await countOwners(admin, branchId);

  const { data: outgoingMembership } = await admin
    .from("ea_branch_members")
    .select("id, role")
    .eq("branch_id", branchId)
    .eq("user_id", outgoingOwnerUserId)
    .maybeSingle();

  const { data: incomingMembership } = await admin
    .from("ea_branch_members")
    .select("id, role")
    .eq("branch_id", branchId)
    .eq("user_id", incomingOwnerUserId)
    .maybeSingle();

  return [
    `outgoing_action=${outgoingAction}`,
    `owner_count=${ownerCount}`,
    `outgoing_membership=${outgoingMembership ? `${outgoingMembership.role}:${outgoingMembership.id}` : "removed"}`,
    `incoming_membership=${incomingMembership ? `${incomingMembership.role}:${incomingMembership.id}` : "missing"}`,
  ].join("; ");
}

async function runExecuteSuite(
  fixture: TestRunFixture,
  options: { cleanupStale: boolean }
) {
  const admin = serviceClient();
  const trackedUsers: TrackedTestUser[] = [];
  const cleanupWarnings: string[] = [];

  const preCleanup = await cleanupFixtureUsers(admin, { fixture });
  if (preCleanup.removed > 0) {
    console.log(
      `Pre-cleanup removed ${preCleanup.removed} prior fixture user(s) for run ${fixture.stamp}.`
    );
  }
  cleanupWarnings.push(...preCleanup.warnings);

  if (options.cleanupStale) {
    const staleCleanup = await cleanupFixtureUsers(admin, {
      includeLegacyKeyneticTestDev: true,
    });
    if (staleCleanup.removed > 0) {
      console.log(
        `Stale cleanup removed ${staleCleanup.removed} orphaned ea-access-dev fixture user(s).`
      );
    }
    cleanupWarnings.push(...staleCleanup.warnings);
  }

  try {
    const owner = await signUpEaAgent(fixture, "owner", "primary");
    trackedUsers.push(owner);
    const staff = await signUpEaAgent(fixture, "staff", "primary");
    trackedUsers.push(staff);
    const outsider = await signUpEaAgent(fixture, "outsider", "secondary");
    trackedUsers.push(outsider);

    const { branchId, ownerMemberId } = await onboardOwner(
      owner.client,
      owner.userId,
      fixture,
      "primary"
    );
    await onboardOwner(
      outsider.client,
      outsider.userId,
      fixture,
      "secondary",
      "-b"
    );

    const { data: outsiderMembership } = await outsider.client
      .from("ea_branch_members")
      .select("branch_id")
      .eq("user_id", outsider.userId)
      .single();
    const outsiderBranchId = outsiderMembership?.branch_id as string;

    record(
      "Exactly one Owner on new branch",
      (await countOwners(admin, branchId)) === 1
    );

    const invite = await owner.client.rpc("create_ea_branch_invitation", {
      p_branch_id: branchId,
      p_invite_email: staff.email,
      p_invite_name: "EA Access Staff",
      p_invite_role: "agent",
    });
    record(
      "Owner can invite Staff",
      invite.data?.ok === true,
      invite.data?.error ?? invite.error?.message
    );

    const ownerInviteBlocked = await owner.client.rpc(
      "create_ea_branch_invitation",
      {
        p_branch_id: branchId,
        p_invite_email: buildTestEmail(fixture, "blocked", "primary"),
        p_invite_name: "Blocked Owner",
        p_invite_role: "branch_admin",
      }
    );
    record(
      "Invitations cannot create Owner",
      ownerInviteBlocked.data?.error === "owner_invitation_not_allowed"
    );

    const token = invite.data?.token as string;
    const accept = await staff.client.rpc("accept_ea_branch_invitation", {
      p_token: token,
    });
    record(
      "Staff accepts invitation",
      accept.data?.ok === true,
      accept.data?.error ?? accept.error?.message
    );

    const { data: staffMembership } = await staff.client
      .from("ea_branch_members")
      .select("id, role")
      .eq("user_id", staff.userId)
      .single();
    const staffMemberId = staffMembership?.id as string;

    const staffDirectory = await staff.client.rpc(
      "get_ea_branch_team_directory",
      { p_branch_id: branchId }
    );
    record(
      "Staff directory has no team-management flag",
      staffDirectory.data?.can_manage_team === false &&
        staffDirectory.data?.can_transfer_ownership === false
    );

    const staffPromote = await staff.client
      .from("ea_branch_members")
      .update({ role: "branch_admin" })
      .eq("id", staffMemberId)
      .select("id");
    record(
      "Staff direct UPDATE denied (promote self)",
      !!staffPromote.error || (staffPromote.data?.length ?? 0) === 0,
      staffPromote.error?.message
    );

    const staffDemoteOwner = await staff.client
      .from("ea_branch_members")
      .update({ role: "agent" })
      .eq("id", ownerMemberId)
      .select("id");
    record(
      "Staff direct UPDATE denied (demote Owner)",
      !!staffDemoteOwner.error || (staffDemoteOwner.data?.length ?? 0) === 0,
      staffDemoteOwner.error?.message
    );

    const staffRemoveOwner = await staff.client.rpc("remove_ea_branch_member", {
      p_member_id: ownerMemberId,
    });
    record(
      "Staff cannot remove Owner",
      staffRemoveOwner.data?.error === "not_branch_admin" ||
        staffRemoveOwner.data?.error === "cannot_remove_owner"
    );

    const staffRemoveStaff = await staff.client.rpc("remove_ea_branch_member", {
      p_member_id: staffMemberId,
    });
    record(
      "Staff cannot remove another Staff",
      staffRemoveStaff.data?.error === "not_branch_admin"
    );

    const revokeEmail = buildTestEmail(fixture, "revoke", "primary");
    const revokeInvite = await owner.client.rpc("create_ea_branch_invitation", {
      p_branch_id: branchId,
      p_invite_email: revokeEmail,
      p_invite_name: "Revoke Test",
      p_invite_role: "agent",
    });
    if (revokeInvite.data?.ok) {
      const revoker = createClient(url!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await revoker.auth.signUp({
        email: revokeEmail,
        password: PASSWORD,
      });
      await revoker.auth.signInWithPassword({
        email: revokeEmail,
        password: PASSWORD,
      });
      const revokerUserId = (await revoker.auth.getUser()).data.user!.id;
      trackedUsers.push({ userId: revokerUserId, email: revokeEmail });
      await revoker.from("profiles").upsert({
        id: revokerUserId,
        role: "homeowner",
        account_type: "estate_agent",
        contact_name: "Revoke Test",
        email_domain: fixture.primaryDomain,
      });

      await owner.client.rpc("revoke_ea_branch_invitation", {
        p_invitation_id: revokeInvite.data.invitation_id,
      });

      const revokedAccept = await revoker.rpc("accept_ea_branch_invitation", {
        p_token: revokeInvite.data.token,
      });
      record(
        "Revoked invitation cannot be accepted",
        revokedAccept.data?.error === "invitation_revoked"
      );
    } else {
      record(
        "Revoked invitation cannot be accepted",
        false,
        revokeInvite.data?.error ?? revokeInvite.error?.message
      );
    }

    await admin
      .from("ea_branch_membership_events")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId);

    const removeStaff = await owner.client.rpc("remove_ea_branch_member", {
      p_member_id: staffMemberId,
    });
    record(
      "Owner removes Staff",
      removeStaff.data?.ok === true,
      removeStaff.data?.error
    );

    const { count: auditAfterRemove } = await admin
      .from("ea_branch_membership_events")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("event_type", "member_removed");
    record(
      "Audit event: member_removed",
      (auditAfterRemove ?? 0) > 0
    );

    const staffTeam = await staff.client.rpc("get_ea_branch_team_directory", {
      p_branch_id: branchId,
    });
    const staffSummaries = await staff.client
      .from("agent_branch_property_summaries")
      .select("property_id")
      .limit(5);
    record(
      "Removed Staff loses branch authorisation (directory)",
      staffTeam.data?.error === "not_branch_member" ||
        staffTeam.data?.ok === false
    );
    record(
      "Removed Staff: summaries empty or denied",
      (staffSummaries.data?.length ?? 0) === 0
    );
    record(
      "Removed Staff remains authenticated",
      !!(await staff.client.auth.getUser()).data.user
    );

    const reinvite = await owner.client.rpc("create_ea_branch_invitation", {
      p_branch_id: branchId,
      p_invite_email: staff.email,
      p_invite_name: "EA Access Staff",
      p_invite_role: "agent",
    });
    record(
      "Removed Staff can be re-invited",
      reinvite.data?.ok === true,
      reinvite.data?.error
    );

    if (reinvite.data?.ok) {
      const reaccept = await staff.client.rpc("accept_ea_branch_invitation", {
        p_token: reinvite.data.token,
      });
      record(
        "Re-invited Staff can rejoin",
        reaccept.data?.ok === true,
        reaccept.data?.error
      );
    }

    const { data: staffMembership2, error: staffMembership2Error } =
      await staff.client
        .from("ea_branch_members")
        .select("id")
        .eq("user_id", staff.userId)
        .eq("branch_id", branchId)
        .maybeSingle();
    if (!staffMembership2?.id) {
      record(
        "Staff membership present before transfer tests",
        false,
        staffMembership2Error?.message ?? "missing staff membership"
      );
    } else {
      const failedTransfer = await owner.client.rpc(
        "transfer_ea_branch_ownership",
        {
          p_branch_id: branchId,
          p_new_owner_member_id: randomUUID(),
          p_outgoing_action: "remain_staff",
        }
      );
      record(
        "Failed transfer leaves Owner intact",
        failedTransfer.data?.ok === false &&
          (await countOwners(admin, branchId)) === 1,
        failedTransfer.data?.error
      );

      const transferRemain = await owner.client.rpc(
        "transfer_ea_branch_ownership",
        {
          p_branch_id: branchId,
          p_new_owner_member_id: staffMembership2.id,
          p_outgoing_action: "remain_staff",
        }
      );
      record(
        "Owner transfers ownership and remains Staff",
        transferRemain.data?.ok === true,
        transferRemain.data?.error
      );
      record(
        "After transfer remain: exactly one Owner",
        (await countOwners(admin, branchId)) === 1
      );

      const ownerNowStaff = await owner.client
        .from("ea_branch_members")
        .select("role")
        .eq("user_id", owner.userId)
        .eq("branch_id", branchId)
        .single();
      const staffNowOwner = await staff.client
        .from("ea_branch_members")
        .select("role")
        .eq("user_id", staff.userId)
        .eq("branch_id", branchId)
        .single();
      record(
        "Previous Owner becomes Staff",
        ownerNowStaff.data?.role === "agent"
      );
      record(
        "New Owner is branch_admin",
        staffNowOwner.data?.role === "branch_admin"
      );

      const oldOwnerManage = await owner.client.rpc(
        "get_ea_branch_team_directory",
        { p_branch_id: branchId }
      );
      record(
        "Previous Owner (Staff) cannot manage team",
        oldOwnerManage.data?.can_manage_team === false
      );

      const crossBranch = await staff.client.rpc(
        "get_ea_branch_team_directory",
        { p_branch_id: outsiderBranchId }
      );
      record(
        "Cross-branch isolation (directory denied)",
        crossBranch.data?.error === "not_branch_member" ||
          crossBranch.data?.ok === false
      );

      const leaveOutgoingAction = "leave_branch";
      const transferLeave = await staff.client.rpc(
        "transfer_ea_branch_ownership",
        {
          p_branch_id: branchId,
          p_new_owner_member_id: ownerMemberId,
          p_outgoing_action: leaveOutgoingAction,
        }
      );
      const leaveTransferDetail = transferLeave.data?.ok
        ? undefined
        : formatRpcFailure(
            await describeLeaveTransferState(
              admin,
              branchId,
              staff.userId,
              owner.userId,
              leaveOutgoingAction
            ),
            transferLeave.data,
            transferLeave.error
          );
      record(
        "Owner transfers ownership and leaves",
        transferLeave.data?.ok === true,
        leaveTransferDetail ?? transferLeave.data?.error
      );

      const outgoingOwnerMembership = await admin
        .from("ea_branch_members")
        .select("id")
        .eq("user_id", staff.userId)
        .eq("branch_id", branchId)
        .maybeSingle();
      record(
        "Previous Owner membership removed after leave transfer",
        !outgoingOwnerMembership.data,
        outgoingOwnerMembership.data
          ? await describeLeaveTransferState(
              admin,
              branchId,
              staff.userId,
              owner.userId,
              leaveOutgoingAction
            )
          : undefined
      );
      record(
        "After leave transfer: exactly one Owner",
        (await countOwners(admin, branchId)) === 1,
        leaveTransferDetail
      );
    }
  } finally {
    const postCleanup = await cleanupFixtureUsers(admin, { fixture });
    if (postCleanup.removed > 0) {
      console.log(
        `Post-cleanup removed ${postCleanup.removed} fixture user(s) for run ${fixture.stamp}.`
      );
    }
    cleanupWarnings.push(...postCleanup.warnings);

    if (cleanupWarnings.length > 0) {
      console.warn("\nCleanup warnings:");
      for (const warning of cleanupWarnings) {
        console.warn(`- ${warning}`);
      }
    }

    void trackedUsers;
  }
}

async function reportStaleFixtureUsers(admin: SupabaseClient) {
  const users = await listAllAuthUsers(admin);
  const stale = users.filter((user) => isIntegrationTestEmail(user.email));
  if (stale.length === 0) {
    console.log("No orphaned ea-access-dev fixture auth users detected.");
    return;
  }

  console.log(
    `Detected ${stale.length} orphaned ea-access-dev fixture auth user(s):`
  );
  for (const user of stale.slice(0, 10)) {
    console.log(`- ${user.email ?? user.id}`);
  }
  if (stale.length > 10) {
    console.log(`- ... and ${stale.length - 10} more`);
  }
  console.log(
    "Re-run with --cleanup-stale to remove orphaned ea-access-dev fixtures only."
  );
}

async function main() {
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }

  assertDevelopmentEnvironment(url);

  const execute = process.argv.includes("--execute");
  const cleanupStale = process.argv.includes("--cleanup-stale");
  const admin = serviceClient();

  console.log(`Development project: ${DEVELOPMENT_SUPABASE_PROJECT_REF}`);
  console.log(`Mode: ${execute ? "EXECUTE (mutating)" : "PREFLIGHT (read-only)"}\n`);

  const migrationOk = await migrationPreflight(admin);
  if (!migrationOk) {
    console.error(
      "\nMigration not detected. Apply 20260721100000 on Development first."
    );
    process.exit(1);
  }

  if (!execute) {
    await reportStaleFixtureUsers(admin);
    console.log(
      "\nPreflight OK. Re-run with --execute to run mutating integration tests."
    );
    return;
  }

  const stamp = `${Date.now().toString(36)}`;
  const fixture = createFixture(stamp);
  console.log(`Fixture primary domain: ${fixture.primaryDomain}`);
  console.log(`Fixture secondary domain: ${fixture.secondaryDomain}\n`);

  await runExecuteSuite(fixture, { cleanupStale });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
