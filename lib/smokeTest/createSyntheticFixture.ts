import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateAccessCode } from "@/lib/accessCode/generateAccessCode";
import {
  createSmokeTestFixture,
  registerSmokeTestFixtureObject,
} from "@/lib/smokeTest/registry";

export type SyntheticSmokeFixtureResult =
  | {
      ok: true;
      fixtureId: string;
      eaUserId: string;
      eaEmail: string;
      homeownerUserId: string;
      homeownerEmail: string;
      companyId: string;
      branchId: string;
      chainId: number;
      propertyId: number;
      temporaryPassword: string;
    }
  | { ok: false; error: string };

function buildSyntheticEmails(stamp: string) {
  // Non-routable local domains — not used for heuristics; fixture registry is authoritative.
  return {
    eaEmail: `smoke-ea+${stamp}@fixture.invalid`,
    homeownerEmail: `smoke-ho+${stamp}@fixture.invalid`,
  };
}

/**
 * Service-role / platform-admin only.
 * Creates a fully synthetic fixture (no Ideal Postcodes) for repeatable smoke tests.
 * Does NOT start Stripe Checkout.
 */
export async function createSyntheticSmokeTestFixture(
  admin: SupabaseClient,
  input: {
    label: string;
    actorAdminUserId?: string | null;
    temporaryPassword?: string;
  }
): Promise<SyntheticSmokeFixtureResult> {
  const stamp = Date.now().toString(36);
  const password =
    input.temporaryPassword ?? `SmokeFixture!${stamp}Aa1`;
  const { eaEmail, homeownerEmail } = buildSyntheticEmails(stamp);

  const fixtureResult = await createSmokeTestFixture(admin, {
    label: input.label,
    notes: "synthetic_smoke_fixture",
    createdByAdminUserId: input.actorAdminUserId,
  });

  if (!fixtureResult.ok) {
    return fixtureResult;
  }

  const fixtureId = fixtureResult.fixture.id;

  const registerOwned = async (
    objectType:
      | "auth_user"
      | "profile"
      | "ea_company"
      | "ea_branch"
      | "ea_branch_member"
      | "property"
      | "chain"
      | "property_member"
      | "property_ea_assignment",
    objectId: string | number
  ) => {
    const result = await registerSmokeTestFixtureObject(admin, {
      fixtureId,
      objectType,
      objectId,
      ownership: "owned",
      actorAdminUserId: input.actorAdminUserId,
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
  };

  try {
    const { data: eaAuth, error: eaAuthError } =
      await admin.auth.admin.createUser({
        email: eaEmail,
        password,
        email_confirm: true,
        user_metadata: {
          account_type: "estate_agent",
          contact_name: "Smoke Test Agent",
        },
      });

    if (eaAuthError || !eaAuth.user) {
      throw new Error(eaAuthError?.message ?? "ea_auth_create_failed");
    }

    const eaUserId = eaAuth.user.id;
    await registerOwned("auth_user", eaUserId);

    // Impersonate EA session is not available; create profile via service role upsert.
    const { error: eaProfileError } = await admin.from("profiles").upsert(
      {
        id: eaUserId,
        role: "homeowner",
        account_type: "estate_agent",
        contact_name: "Smoke Test Agent",
        email_domain: "fixture.invalid",
        onboarding_completed_at: null,
      },
      { onConflict: "id" }
    );
    if (eaProfileError) {
      throw new Error(eaProfileError.message);
    }
    await registerOwned("profile", eaUserId);

    const { data: company, error: companyError } = await admin
      .from("ea_companies")
      .insert({
        name: `Smoke Fixture Co ${stamp}`,
        email_domain: `fixture-${stamp}.invalid`,
        created_by_user_id: eaUserId,
      })
      .select("id")
      .single();
    if (companyError || !company) {
      throw new Error(companyError?.message ?? "company_create_failed");
    }
    await registerOwned("ea_company", company.id);

    const { data: branch, error: branchError } = await admin
      .from("ea_branches")
      .insert({
        company_id: company.id,
        name: `Smoke Branch ${stamp}`,
        town_or_city: "Fareham",
        postcode: "PO14 1AA",
        region_code: "UK-SOUTH-EAST",
        is_head_office: true,
      })
      .select("id")
      .single();
    if (branchError || !branch) {
      throw new Error(branchError?.message ?? "branch_create_failed");
    }
    await registerOwned("ea_branch", branch.id);

    const { data: membership, error: memberError } = await admin
      .from("ea_branch_members")
      .insert({
        branch_id: branch.id,
        user_id: eaUserId,
        role: "branch_admin",
      })
      .select("id")
      .single();
    if (memberError || !membership) {
      throw new Error(memberError?.message ?? "member_create_failed");
    }
    await registerOwned("ea_branch_member", membership.id);

    await admin
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", eaUserId);

    const { data: hoAuth, error: hoAuthError } =
      await admin.auth.admin.createUser({
        email: homeownerEmail,
        password,
        email_confirm: true,
      });
    if (hoAuthError || !hoAuth.user) {
      throw new Error(hoAuthError?.message ?? "homeowner_auth_create_failed");
    }
    const homeownerUserId = hoAuth.user.id;
    await registerOwned("auth_user", homeownerUserId);

    const { error: hoProfileError } = await admin.from("profiles").upsert(
      {
        id: homeownerUserId,
        role: "homeowner",
        account_type: "homeowner",
      },
      { onConflict: "id" }
    );
    if (hoProfileError) {
      throw new Error(hoProfileError.message);
    }
    await registerOwned("profile", homeownerUserId);

    const { data: chain, error: chainError } = await admin
      .from("chains")
      .insert({
        name: `SMOKE-${stamp}`,
        access_code: generateAccessCode(),
        created_by_user_id: homeownerUserId,
      })
      .select("id")
      .single();
    if (chainError || !chain) {
      throw new Error(chainError?.message ?? "chain_create_failed");
    }
    await registerOwned("chain", chain.id);

    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({
        chain_id: chain.id,
        address: `Synthetic Smoke Property ${stamp}`,
        postcode: "PO14 9ZZ",
        stage: "offer_accepted",
        status: "healthy",
        relationship_type: "sale",
        created_by_user_id: homeownerUserId,
      })
      .select("id")
      .single();
    if (propertyError || !property) {
      throw new Error(propertyError?.message ?? "property_create_failed");
    }
    await registerOwned("property", property.id);

    const { data: propMember, error: propMemberError } = await admin
      .from("property_members")
      .insert({
        property_id: property.id,
        user_id: homeownerUserId,
        role: "seller",
      })
      .select("id")
      .single();
    if (propMemberError || !propMember) {
      throw new Error(propMemberError?.message ?? "property_member_failed");
    }
    await registerOwned("property_member", propMember.id);

    const { data: assignment, error: assignmentError } = await admin
      .from("property_ea_assignments")
      .insert({
        property_id: property.id,
        branch_id: branch.id,
        status: "active",
        homeowner_only_updates: true,
        assigned_by_user_id: homeownerUserId,
      })
      .select("id")
      .single();
    if (assignmentError || !assignment) {
      throw new Error(assignmentError?.message ?? "assignment_failed");
    }
    await registerOwned("property_ea_assignment", assignment.id);

    return {
      ok: true,
      fixtureId,
      eaUserId,
      eaEmail,
      homeownerUserId,
      homeownerEmail,
      companyId: company.id,
      branchId: branch.id,
      chainId: chain.id,
      propertyId: property.id,
      temporaryPassword: password,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "synthetic_fixture_failed",
    };
  }
}
