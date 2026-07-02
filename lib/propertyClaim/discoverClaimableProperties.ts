import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimablePropertySummary } from "@/lib/propertyClaim/types";

function parseClaimableProperties(
  data: unknown
): ClaimablePropertySummary[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((row) => {
    if (
      typeof row !== "object" ||
      row == null ||
      typeof (row as ClaimablePropertySummary).property_id !==
        "number"
    ) {
      return [];
    }

    const summary = row as ClaimablePropertySummary;

    return [
      {
        property_id: summary.property_id,
        address: summary.address ?? null,
        postcode: summary.postcode ?? null,
        branch_name: summary.branch_name ?? "Estate agent branch",
        in_chain: Boolean(summary.in_chain),
        claim_status: summary.claim_status,
      },
    ];
  });
}

export async function discoverClaimableProperties(
  supabase: SupabaseClient
): Promise<ClaimablePropertySummary[]> {
  const { data, error } = await supabase.rpc(
    "discover_claimable_properties"
  );

  if (error) {
    console.error(error);
    return [];
  }

  return parseClaimableProperties(data);
}

export function filterClaimableProperties(
  properties: ClaimablePropertySummary[],
  propertyId: number | null | undefined
): ClaimablePropertySummary[] {
  if (propertyId == null) {
    return properties;
  }

  return properties.filter(
    (property) =>
      property.property_id === propertyId
  );
}

export function hasClaimableProperties(
  properties: ClaimablePropertySummary[]
): boolean {
  return properties.length > 0;
}
