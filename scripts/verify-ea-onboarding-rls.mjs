import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

const envText = readFileSync(".env.local", "utf8");
for (const line of envText.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sb = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Unique per run so the agency email-domain uniqueness index never sees a
// domain from an earlier run; only rows created here are cleaned up.
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const emailDomain = `ea-onboarding-${runId}.verify-agency.co.uk`;
const email = `ea-verify@${emailDomain}`;
const password = "VerifyTest123!";
const companyName = `Verify Agency ${runId}`;
const branchName = "Main Office";
const townOrCity = "London";
const postcode = "SW1A 1AA";

const created = { userId: null, companyId: null, branchId: null };

async function cleanup() {
  const warn = (label, error) => {
    if (error) console.warn(`cleanup ${label}: ${error.message}`);
  };
  // Deleting the branch cascades its members (the owner invariant skips a
  // deleted branch).
  if (created.branchId) {
    warn("ea_branches", (await admin.from("ea_branches").delete().eq("id", created.branchId)).error);
  }
  if (created.companyId) {
    warn("ea_companies", (await admin.from("ea_companies").delete().eq("id", created.companyId)).error);
  }
  if (created.userId) {
    warn("profiles", (await admin.from("profiles").delete().eq("id", created.userId)).error);
    warn("auth user", (await admin.auth.admin.deleteUser(created.userId)).error);
  }
}

async function run() {
  console.log("Creating isolated test EA account");

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user?.id) {
    throw new Error(`createUser: ${userError?.message ?? "no user"}`);
  }
  created.userId = user.user.id;

  const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  const userId = created.userId;

  const { error: profileUpsertError } = await sb.from("profiles").upsert({
    id: userId,
    role: "homeowner",
    account_type: "estate_agent",
    contact_name: "Verify User",
    email_domain: emailDomain,
    onboarding_completed_at: null,
  });
  if (profileUpsertError) throw new Error(`profile: ${profileUpsertError.message}`);

  const { data: company, error: companyError } = await sb
    .from("ea_companies")
    .insert({
      name: companyName,
      email_domain: emailDomain,
      created_by_user_id: userId,
    })
    .select("id, name")
    .single();

  console.log("\n1. ea_companies:", company ? "ok" : companyError?.message);
  if (!company) return false;
  created.companyId = company.id;

  const { data: branch, error: branchError } = await sb
    .from("ea_branches")
    .insert({
      company_id: company.id,
      name: branchName,
      town_or_city: townOrCity,
      postcode,
      region_code: "UK-LONDON",
      is_head_office: true,
    })
    .select("id, name, town_or_city, postcode")
    .single();

  console.log("2. ea_branches:", branch ? "ok" : branchError?.message);
  if (!branch) return false;
  created.branchId = branch.id;

  const { error: memberError } = await sb.from("ea_branch_members").insert({
    branch_id: branch.id,
    user_id: userId,
    role: "branch_admin",
  });

  console.log("3. ea_branch_members:", memberError?.message ?? "ok");
  if (memberError) return false;

  const completedAt = new Date().toISOString();
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .update({ onboarding_completed_at: completedAt })
    .eq("id", userId)
    .eq("account_type", "estate_agent")
    .select("onboarding_completed_at")
    .single();

  console.log("4. onboarding_completed_at:", profile?.onboarding_completed_at ? "ok" : profileError?.message);
  return Boolean(profile?.onboarding_completed_at);
}

let passed = false;
try {
  passed = await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  await cleanup();
}

if (!passed) {
  process.exit(1);
}
console.log("\nOnboarding DB verification passed.");
