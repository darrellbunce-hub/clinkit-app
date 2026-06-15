import { notFound } from "next/navigation";

import { parsePositiveIntParam } from "@/lib/auth/chainAccess";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Server route guard for `/property/[propertyId]`.
 *
 * Authorizes when the property appears in `chain_properties_participant` for
 * the current user (chain participant with view access to that row).
 */
export async function requirePropertyParticipantForRoute(
  propertyIdRaw: string | undefined
): Promise<number> {
  const propertyId = parsePositiveIntParam(
    propertyIdRaw
  );

  if (propertyId === null) {
    notFound();
  }

  const supabase =
    await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data, error } = await supabase
    .from("chain_properties_participant")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  return propertyId;
}
