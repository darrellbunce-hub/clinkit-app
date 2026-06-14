import { createClient } from "@supabase/supabase-js";
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.EA_EMAIL;
const password = process.env.EA_PASSWORD;

async function inspectWithSession(supabase, label) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.log(`\n=== ${label}: no authenticated user ===`);
    console.log(userError?.message ?? "missing session");

    return;
  }

  console.log(`\n=== ${label}: ${user.email} (${user.id}) ===`);

  const { data: profile, error: profileError } =
    await supabase
      .from("profiles")
      .select(
        "account_type, contact_name, email_domain, onboarding_completed_at, role"
      )
      .eq("id", user.id)
      .maybeSingle();

  console.log("profiles:", profile ?? profileError?.message);

  const { data: memberships, error: membershipError } =
    await supabase
      .from("ea_branch_members")
      .select("branch_id, role, joined_at")
      .eq("user_id", user.id);

  console.log(
    "ea_branch_members:",
    memberships ?? membershipError?.message
  );

  if (memberships?.length) {
    for (const membership of memberships) {
      const { data: branch, error: branchError } =
        await supabase
          .from("ea_branches")
          .select(
            "id, name, town_or_city, postcode, company_id, is_head_office"
          )
          .eq("id", membership.branch_id)
          .maybeSingle();

      console.log("ea_branches:", branch ?? branchError?.message);

      if (branch?.company_id) {
        const { data: company, error: companyError } =
          await supabase
            .from("ea_companies")
            .select("id, name, email_domain, created_by_user_id")
            .eq("id", branch.company_id)
            .maybeSingle();

        console.log(
          "ea_companies:",
          company ?? companyError?.message
        );
      }
    }
  }
}

if (serviceKey) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: estateAgents, error } = await admin
    .from("profiles")
    .select(
      "id, account_type, contact_name, email_domain, onboarding_completed_at"
    )
    .eq("account_type", "estate_agent");

  console.log("=== ADMIN: all estate_agent profiles ===");
  console.log(estateAgents ?? error?.message);

  if (estateAgents?.length) {
    for (const profile of estateAgents) {
      const { data: authUser } =
        await admin.auth.admin.getUserById(profile.id);

      console.log("\n---", authUser?.user?.email, profile.id, "---");

      const { data: memberships } = await admin
        .from("ea_branch_members")
        .select("*")
        .eq("user_id", profile.id);

      console.log("memberships:", memberships);

      if (memberships?.length) {
        const { data: branch } = await admin
          .from("ea_branches")
          .select("*")
          .eq("id", memberships[0].branch_id)
          .maybeSingle();

        console.log("branch:", branch);

        if (branch?.company_id) {
          const { data: company } = await admin
            .from("ea_companies")
            .select("*")
            .eq("id", branch.company_id)
            .maybeSingle();

          console.log("company:", company);
        }
      }
    }
  }
} else {
  console.log("SUPABASE_SERVICE_ROLE_KEY not set — skipping admin inspection.");
}

if (email && password) {
  const client = createClient(url, anonKey);
  const { error: signInError } =
    await client.auth.signInWithPassword({
      email,
      password,
    });

  if (signInError) {
    console.error("EA login failed:", signInError.message);
    process.exit(1);
  }

  await inspectWithSession(client, "EA session");
} else {
  console.log(
    "Set EA_EMAIL and EA_PASSWORD to inspect a specific account via RLS."
  );
}
