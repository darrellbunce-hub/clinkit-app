import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findSearchingPlaceholderForUser,
  insertSearchingPlaceholder,
} from "@/lib/searchingPlaceholder";

export type JoinedPropertyRef = {
  id: number;
  chain_id: number;
  linked_property_id: number | null;
};

export type SourceChainMigrationResult = {
  onwardSearchingId: number | null;
  onwardSaleMigrated: boolean;
};

export type SourceChainMigrationStep =
  | "lookup_onward_searching"
  | "lookup_onward_sale"
  | "move_onward_searching"
  | "move_onward_sale";

/**
 * Thrown when onward properties could not be moved off the source chain.
 * Callers must not run cleanup_abandoned_onboarding_chain afterwards: it deletes
 * every property still on the source chain.
 */
export class SourceChainMigrationError extends Error {
  readonly step: SourceChainMigrationStep;
  readonly sourceError: unknown;

  constructor(step: SourceChainMigrationStep, sourceError: unknown) {
    super(`Source chain migration failed at ${step}`);
    this.name = "SourceChainMigrationError";
    this.step = step;
    this.sourceError = sourceError;
  }
}

export const SOURCE_CHAIN_MIGRATION_FAILED_MESSAGE =
  "We could not finish joining this chain because your existing move details " +
  "could not be moved across. Your original move details have been kept and " +
  "nothing was removed. Please contact support before trying again.";

export type TopologyRelinkResult =
  | { ok: true; linkedSearchingId: number }
  | {
      ok: false;
      reason: "downstream_link_exists";
      existingLinkedPropertyId: number;
    };

export function evaluateJoinedPropertyRelink(
  currentLinkedPropertyId: number | null,
  targetSearchingId: number
): TopologyRelinkResult | { ok: true; alreadyLinked: true } {
  if (currentLinkedPropertyId === null) {
    return { ok: true, linkedSearchingId: targetSearchingId };
  }

  if (
    currentLinkedPropertyId === targetSearchingId
  ) {
    return { ok: true, alreadyLinked: true };
  }

  return {
    ok: false,
    reason: "downstream_link_exists",
    existingLinkedPropertyId:
      currentLinkedPropertyId,
  };
}

export async function migrateSourceChainOnwardProperties(
  supabase: SupabaseClient,
  params: {
    sourceChainId: string;
    userId: string;
    joinedProperty: JoinedPropertyRef;
    excludePropertyId: number;
  }
): Promise<SourceChainMigrationResult> {
  const {
    data: onwardSearching,
    error: onwardSearchingError,
  } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", params.sourceChainId)
    .eq("stage", "searching")
    .eq("created_by_user_id", params.userId)
    .maybeSingle();

  if (onwardSearchingError) {
    throw new SourceChainMigrationError(
      "lookup_onward_searching",
      onwardSearchingError
    );
  }

  const {
    data: onwardSale,
    error: onwardSaleError,
  } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", params.sourceChainId)
    .eq("relationship_type", "sale")
    .eq("created_by_user_id", params.userId)
    .neq("id", params.excludePropertyId)
    .maybeSingle();

  if (onwardSaleError) {
    throw new SourceChainMigrationError(
      "lookup_onward_sale",
      onwardSaleError
    );
  }

  // RLS-filtered updates succeed with zero rows, so require exactly one updated row.
  if (onwardSearching) {
    const {
      data: movedSearching,
      error: moveSearchingError,
    } = await supabase
      .from("properties")
      .update({
        chain_id: params.joinedProperty.chain_id,
      })
      .eq("id", onwardSearching.id)
      .select("id");

    if (moveSearchingError || movedSearching?.length !== 1) {
      throw new SourceChainMigrationError(
        "move_onward_searching",
        moveSearchingError ?? "no_row_updated"
      );
    }
  }

  if (onwardSale) {
    const {
      data: movedSale,
      error: moveSaleError,
    } = await supabase
      .from("properties")
      .update({
        linked_property_id:
          params.joinedProperty.id,
        chain_id: params.joinedProperty.chain_id,
      })
      .eq("id", onwardSale.id)
      .select("id");

    if (moveSaleError || movedSale?.length !== 1) {
      throw new SourceChainMigrationError(
        "move_onward_sale",
        moveSaleError ?? "no_row_updated"
      );
    }
  }

  return {
    onwardSearchingId:
      onwardSearching?.id ?? null,
    onwardSaleMigrated: !!onwardSale,
  };
}

export type JoinedPropertyRelinkResult =
  | { ok: true; linkedSearchingId: number }
  | { ok: true; alreadyLinked: true }
  | {
      ok: false;
      reason: "downstream_link_exists";
      existingLinkedPropertyId: number;
    }
  | { ok: false; reason: "relink_not_applied" };

export async function relinkJoinedPropertyToSearching(
  supabase: SupabaseClient,
  joinedProperty: JoinedPropertyRef,
  searchingId: number
): Promise<JoinedPropertyRelinkResult> {
  const relinkDecision =
    evaluateJoinedPropertyRelink(
      joinedProperty.linked_property_id,
      searchingId
    );

  if (!relinkDecision.ok) {
    return relinkDecision;
  }

  if ("alreadyLinked" in relinkDecision) {
    return relinkDecision;
  }

  // RLS-filtered updates succeed with zero rows, so require exactly one updated row.
  const { data: relinked, error } = await supabase
    .from("properties")
    .update({
      linked_property_id: searchingId,
    })
    .eq("id", joinedProperty.id)
    .select("id");

  if (error) {
    throw error;
  }

  if (relinked?.length !== 1) {
    return { ok: false, reason: "relink_not_applied" };
  }

  return relinkDecision;
}

export type IntentSearchingResult =
  | {
      ok: true;
      searchingId: number;
      created: boolean;
    }
  | {
      ok: false;
      reason:
        | "downstream_link_exists"
        | "relink_not_applied"
        | "insert_failed";
      existingLinkedPropertyId?: number;
      error?: unknown;
    };

export async function resolveSearchingFromJoinIntent(
  supabase: SupabaseClient,
  params: {
    userId: string;
    joinedProperty: JoinedPropertyRef;
    searchingIntent: boolean;
    migratedSearchingId: number | null;
  }
): Promise<IntentSearchingResult | null> {
  if (!params.searchingIntent) {
    return null;
  }

  if (params.migratedSearchingId) {
    return null;
  }

  let searchingId: number | null = null;
  let created = false;

  const existingPlaceholder =
    await findSearchingPlaceholderForUser(
      supabase,
      params.joinedProperty.chain_id,
      params.userId
    );

  if (existingPlaceholder) {
    searchingId = existingPlaceholder.id;
  } else {
    const {
      placeholder,
      error,
    } = await insertSearchingPlaceholder(
      supabase,
      {
        chainId:
          params.joinedProperty.chain_id,
        userId: params.userId,
      }
    );

    if (error || !placeholder) {
      const racedPlaceholder =
        await findSearchingPlaceholderForUser(
          supabase,
          params.joinedProperty.chain_id,
          params.userId
        );

      if (racedPlaceholder) {
        searchingId = racedPlaceholder.id;
      } else {
        return {
          ok: false,
          reason: "insert_failed",
          error,
        };
      }
    } else {
      searchingId = placeholder.id;
      created = true;
    }
  }

  const relinkResult =
    await relinkJoinedPropertyToSearching(
      supabase,
      params.joinedProperty,
      searchingId!
    );

  if (!relinkResult.ok) {
    if (relinkResult.reason === "relink_not_applied") {
      return { ok: false, reason: "relink_not_applied" };
    }

    return {
      ok: false,
      reason: "downstream_link_exists",
      existingLinkedPropertyId:
        relinkResult.existingLinkedPropertyId,
    };
  }

  return {
    ok: true,
    searchingId: searchingId!,
    created,
  };
}

/** Customer-safe message when the joined property could not be linked to the next-home search step. */
export const JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE =
  "Join completed, but we could not link your next-home search step to this property. " +
  "Nothing was removed. Please try again from the chain page or contact support.";

export function formatJoinedPropertyRelinkFailure(
  result: Extract<JoinedPropertyRelinkResult, { ok: false }>
): string {
  return result.reason === "relink_not_applied"
    ? JOINED_PROPERTY_RELINK_NOT_APPLIED_MESSAGE
    : formatTopologyConflictMessage(result.existingLinkedPropertyId);
}

/** Customer-safe message when join-chain searching setup conflicts with an existing downstream link. */
export function formatTopologyConflictMessage(
  existingLinkedPropertyId: number
): string {
  if (existingLinkedPropertyId < 0) {
    return "";
  }

  return (
    "This property already has a downstream link in the chain. " +
    "Join completed, but we could not set up your next-home search step " +
    "without replacing an existing link. Please review the chain or contact support."
  );
}
