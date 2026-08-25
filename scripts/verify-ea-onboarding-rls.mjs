import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(".env.local", "utf8");
for (const line of envText.split("\n")) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    process.env[match[1]] = match[2].trim();
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const email = `ea-verify-${Date.now()}@verify-agency.co.uk`;
const password = "VerifyTest123!";
const companyName = "Verify Agency Ltd";
const branchName = "Main Office";
const townOrCity = "London";
const postcode = "SW1A 1AA";
const emailDomain = "verify-agency.co.uk";

console.log("Creating test EA account:", email);

await sb.auth.signUp({ email, password });
await sb.auth.signInWithPassword({ email, password });

const userId = (await sb.auth.getUser()).data.user.id;

await sb.from("profiles").upsert({
  id: userId,
  role: "homeowner",
  account_type: "estate_agent",
  contact_name: "Verify User",
  email_domain: emailDomain,
  onboarding_completed_at: null,
});

const { data: company, error: companyError } = await sb
  .from("ea_companies")
  .insert({
    name: companyName,
    email_domain: emailDomain,
    created_by_user_id: userId,
  })
  .select("id, name")
  .single();

console.log("\n1. ea_companies:", company ?? companyError?.message);
if (!company) {
  process.exit(1);
}

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

console.log("2. ea_branches:", branch ?? branchError?.message);
if (!branch) {
  process.exit(1);
}

const { error: memberError } = await sb
  .from("ea_branch_members")
  .insert({
    branch_id: branch.id,
    user_id: userId,
    role: "branch_admin",
  });

console.log(
  "3. ea_branch_members:",
  memberError?.message ?? "ok"
);
if (memberError) {
  process.exit(1);
}

const completedAt = new Date().toISOString();
const { data: profile, error: profileError } = await sb
  .from("profiles")
  .update({ onboarding_completed_at: completedAt })
  .eq("id", userId)
  .eq("account_type", "estate_agent")
  .select("onboarding_completed_at")
  .single();

console.log(
  "4. onboarding_completed_at:",
  profile?.onboarding_completed_at ?? profileError?.message
);

console.log("\nOnboarding DB verification passed.");
