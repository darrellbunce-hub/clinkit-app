import type { SupabaseClient } from "@supabase/supabase-js";

import type { HomeownerInvitationEmailParams } from "@/lib/communications/types";
import { loadPropertyInvitationStatus } from "@/lib/propertyClaim/propertyInvitations";

type PropertyRow = {
  address: string | null;
  postcode: string | null;
};

type MetadataRow = {
  invite_email: string | null;
  invite_display_name: string | null;
};

type AssignmentRow = {
  branch: {
    name: string | null;
    company: {
      name: string | null;
    } | null;
  } | null;
};

function formatPropertyAddress(property: PropertyRow): string {
  const parts = [property.address, property.postcode].filter(
    (part): part is string => Boolean(part?.trim())
  );

  return parts.join(", ") || "Your property";
}

export async function loadHomeownerInvitationEmailContext(
  supabase: SupabaseClient,
  propertyId: number,
  claimUrl: string,
  expiresAt: string
): Promise<HomeownerInvitationEmailParams | null> {
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("address, postcode")
    .eq("id", propertyId)
    .maybeSingle();

  if (propertyError) {
    console.error(
      "[communications] Failed to load property for invitation email:",
      propertyError.message
    );
    return null;
  }

  const { data: metadata, error: metadataError } = await supabase
    .from("property_claim_metadata")
    .select("invite_email, invite_display_name")
    .eq("property_id", propertyId)
    .maybeSingle();

  if (metadataError) {
    console.error(
      "[communications] Failed to load invitation metadata:",
      metadataError.message
    );
    return null;
  }

  if (!metadata?.invite_email?.trim()) {
    return null;
  }

  const { data: assignment } = await supabase
    .from("property_ea_assignments")
    .select(
      `
      branch:ea_branches (
        name,
        company:ea_companies (
          name
        )
      )
    `
    )
    .eq("property_id", propertyId)
    .eq("status", "active")
    .maybeSingle();

  const branchData = assignment as AssignmentRow | null;

  return {
    to: metadata.invite_email.trim(),
    homeownerName:
      metadata.invite_display_name?.trim() || "there",
    propertyAddress: formatPropertyAddress(
      (property ?? {
        address: null,
        postcode: null,
      }) as PropertyRow
    ),
    branchName:
      branchData?.branch?.name?.trim() || "Your estate agent branch",
    companyName:
      branchData?.branch?.company?.name?.trim() ||
      "Your estate agent",
    invitationLink: claimUrl,
    expiresAt,
  };
}

export async function loadActiveInvitationExpiresAt(
  supabase: SupabaseClient,
  propertyId: number
): Promise<string | null> {
  const status = await loadPropertyInvitationStatus(
    supabase,
    propertyId
  );

  if (!status.ok || status.state !== "active") {
    return null;
  }

  return status.expiresAt;
}
