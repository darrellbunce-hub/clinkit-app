/**
 * Batch 10 — EA-01 atomic founder onboarding (static + mock).
 * Does not create shared Development records.
 *
 *   npx tsx scripts/verify-ea-onboarding-atomicity-batch10.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  completeEstateAgentOnboarding,
  mapCompleteEstateAgentOnboardingError,
  mapCompleteEstateAgentOnboardingTransportError,
} from "../lib/estateAgent/completeOnboarding";

const root = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

const migration = read(
  "supabase/migrations/20261125220000_complete_estate_agent_onboarding_atomic.sql"
);
const client = read("lib/estateAgent/completeOnboarding.ts");
const onboardingPage = read("app/estate-agents/onboarding/page.tsx");

// ---------------------------------------------------------------------------
// Migration shape / safety
// ---------------------------------------------------------------------------

check(
  "Migration defines complete_estate_agent_onboarding RPC",
  migration.includes(
    "create or replace function public.complete_estate_agent_onboarding("
  )
);

check(
  "RPC is SECURITY DEFINER with fixed search_path",
  /security definer\s+set search_path = public/.test(migration)
);

check(
  "RPC uses auth.uid() (no caller-chosen user id)",
  migration.includes("v_user_id uuid := auth.uid()") &&
    !/p_user_id/.test(migration)
);

check(
  "Domain comes from profiles.email_domain, not a free-form claim",
  migration.includes("v_email_domain := lower(trim(coalesce(v_profile.email_domain") &&
    !/p_email_domain/.test(migration)
);

check(
  "Atomic inserts cover company, branch, membership, profile completion",
  migration.includes("insert into public.ea_companies") &&
    migration.includes("insert into public.ea_branches") &&
    migration.includes("insert into public.ea_branch_members") &&
    migration.includes("onboarding_completed_at = coalesce")
);

check(
  "Unique domain conflict maps to domain_already_registered for foreign owners",
  migration.includes("when unique_violation then") &&
    migration.includes("'domain_already_registered'")
);

check(
  "Founder-owned incomplete company can be resumed",
  migration.includes("c.created_by_user_id = v_user_id") &&
    migration.includes("v_recovered := true")
);

check(
  "Already-completed path is idempotent",
  migration.includes("'already_completed', true")
);

check(
  "profile_update_failed raises so earlier inserts roll back",
  /raise exception 'profile_update_failed'/.test(migration) &&
    !migration.includes("'error', 'profile_update_failed'") &&
    migration.includes("using errcode = 'P0001'")
);

check(
  "Returned ok false is documented as non-rolling-back",
  migration.includes(
    "does not roll back earlier writes"
  )
);

check(
  "Resume path remains for a previously committed incomplete company",
  migration.includes("c.created_by_user_id = v_user_id") &&
    migration.includes("v_recovered := true") &&
    migration.includes("insert into public.ea_companies")
);

check(
  "Execute granted only to authenticated; revoked from anon/public",
  migration.includes(
    "grant execute on function public.complete_estate_agent_onboarding"
  ) &&
    migration.includes("from anon") &&
    migration.includes("from public")
);

check(
  "Migration documents local-only / rollback",
  migration.includes("LOCAL MIGRATION ONLY") &&
    migration.includes("drop function if exists public.complete_estate_agent_onboarding")
);

check(
  "Client no longer multi-step inserts companies/branches/members",
  !client.includes('.from("ea_companies")') &&
    !client.includes('.from("ea_branches")') &&
    !client.includes('.from("ea_branch_members")') &&
    client.includes('"complete_estate_agent_onboarding"') &&
    client.includes("supabase.rpc(")
);

check(
  "Onboarding page still uses completeEstateAgentOnboarding",
  onboardingPage.includes("completeEstateAgentOnboarding")
);

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

check(
  "Duplicate-domain message remains non-misleading for foreign owners",
  mapCompleteEstateAgentOnboardingError("domain_already_registered").includes(
    "already registered"
  ) &&
    mapCompleteEstateAgentOnboardingError("domain_already_registered").includes(
      "invite"
    )
);

check(
  "Validation failures map to clear field messages",
  mapCompleteEstateAgentOnboardingError("invalid_company_name").includes(
    "company name"
  ) &&
    mapCompleteEstateAgentOnboardingError("invalid_postcode").includes(
      "postcode"
    )
);

check(
  "profile_update_failed copy does not claim a branch was created",
  mapCompleteEstateAgentOnboardingError("profile_update_failed").includes(
    "finish onboarding"
  ) &&
    mapCompleteEstateAgentOnboardingError("profile_update_failed").includes(
      "Nothing was saved"
    ) &&
    !mapCompleteEstateAgentOnboardingError(
      "profile_update_failed"
    ).includes("branch was created")
);

// ---------------------------------------------------------------------------
// Mocked RPC scenarios (no shared DB)
// ---------------------------------------------------------------------------

type RpcResult = Record<string, unknown>;

function mockSupabase(options: {
  userId?: string | null;
  rpcData?: RpcResult | null;
  rpcError?: { message: string } | null;
}) {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: options.userId ? { id: options.userId } : null,
        },
      }),
    },
    rpc: async () => ({
      data: options.rpcData ?? null,
      error: options.rpcError ?? null,
    }),
  };
}

const baseInput = {
  userId: "user-1",
  companyName: "Acme Agency",
  branchName: "Fareham",
  townOrCity: "Fareham",
  postcode: "PO16 7BB",
  isHeadOffice: true,
  emailDomain: "acme-agency.co.uk",
};

async function runMock(
  label: string,
  supabase: ReturnType<typeof mockSupabase>,
  expectSuccess: boolean,
  expectBranchId?: string,
  expectErrorIncludes?: string
) {
  const result = await completeEstateAgentOnboarding(
    supabase as never,
    baseInput
  );

  if (expectSuccess) {
    check(
      label,
      result.success === true &&
        (!expectBranchId ||
          (result.success && result.summary.branchId === expectBranchId))
    );
    return;
  }

  check(
    label,
    result.success === false &&
      (!expectErrorIncludes ||
        (result.success === false &&
          result.error.includes(expectErrorIncludes)))
  );
}

async function main() {
  await runMock(
    "Mock: successful onboarding returns branch id",
    mockSupabase({
      userId: "user-1",
      rpcData: {
        ok: true,
        branch_id: "branch-1",
        company_name: "Acme Agency",
        branch_name: "Fareham",
        town_or_city: "Fareham",
        postcode: "PO16 7BB",
      },
    }),
    true,
    "branch-1"
  );

  await runMock(
    "Mock: failure before company create (not authenticated)",
    mockSupabase({ userId: null }),
    false,
    undefined,
    "log in"
  );

  await runMock(
    "Mock: RPC reports domain already registered",
    mockSupabase({
      userId: "user-1",
      rpcData: { ok: false, error: "domain_already_registered" },
    }),
    false,
    undefined,
    "already registered"
  );

  await runMock(
    "Mock: RPC transport / company-layer failure",
    mockSupabase({
      userId: "user-1",
      rpcError: { message: "Could not create your company." },
    }),
    false,
    undefined,
    "Could not create your company"
  );

  await runMock(
    "Mock: branch-layer style failure code surfaces clearly",
    mockSupabase({
      userId: "user-1",
      rpcData: { ok: false, error: "invalid_branch_name" },
    }),
    false,
    undefined,
    "branch name"
  );

  await runMock(
    "Mock: membership/profile completion failure mapped",
    mockSupabase({
      userId: "user-1",
      rpcData: { ok: false, error: "profile_update_failed" },
    }),
    false,
    undefined,
    "Nothing was saved"
  );

  await runMock(
    "Mock: raised profile_update_failed is retryable and does not claim a saved branch",
    mockSupabase({
      userId: "user-1",
      rpcError: { message: "profile_update_failed" },
    }),
    false,
    undefined,
    "Nothing was saved"
  );

  check(
    "Transport mapper recognises wrapped profile_update_failed",
    mapCompleteEstateAgentOnboardingTransportError(
      "ERROR: profile_update_failed"
    ).includes("Nothing was saved") &&
      !mapCompleteEstateAgentOnboardingTransportError(
        "permission denied"
      ).includes("Nothing was saved")
  );

  await runMock(
    "Mock: safe retry / already completed returns branch",
    mockSupabase({
      userId: "user-1",
      rpcData: {
        ok: true,
        already_completed: true,
        branch_id: "branch-existing",
        company_name: "Acme Agency",
        branch_name: "Fareham",
        town_or_city: "Fareham",
        postcode: "PO16 7BB",
      },
    }),
    true,
    "branch-existing"
  );

  await runMock(
    "Mock: recovered incomplete founder path returns success",
    mockSupabase({
      userId: "user-1",
      rpcData: {
        ok: true,
        recovered: true,
        branch_id: "branch-recovered",
        company_name: "Acme Agency",
        branch_name: "Fareham",
        town_or_city: "Fareham",
        postcode: "PO16 7BB",
      },
    }),
    true,
    "branch-recovered"
  );

  {
    const result = await completeEstateAgentOnboarding(
      mockSupabase({ userId: "user-1" }) as never,
      { ...baseInput, companyName: "A" }
    );
    check(
      "Client validation: company name too short never calls success",
      result.success === false && result.error.includes("company name")
    );
  }

  {
    const result = await completeEstateAgentOnboarding(
      mockSupabase({ userId: "other-user" }) as never,
      baseInput
    );
    check(
      "Authorisation boundary: session user must match input userId",
      result.success === false && result.error.toLowerCase().includes("log in")
    );
  }

  {
    const result = await completeEstateAgentOnboarding(
      mockSupabase({ userId: "user-1" }) as never,
      { ...baseInput, emailDomain: "" }
    );
    check(
      "Authorisation / ownership: missing profile domain blocked client-side",
      result.success === false && result.error.toLowerCase().includes("domain")
    );
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }

  console.log("\nAll Batch 10 EA onboarding atomicity checks passed.");
}

void main();