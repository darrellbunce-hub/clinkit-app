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
  } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", params.sourceChainId)
    .eq("stage", "searching")
    .eq("created_by_user_id", params.userId)
    .maybeSingle();

  const {
    data: onwardSale,
  } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", params.sourceChainId)
    .eq("relationship_type", "sale")
    .eq("created_by_user_id", params.userId)
    .neq("id", params.excludePropertyId)
    .maybeSingle();

  if (onwardSearching) {
    await supabase
      .from("properties")
      .update({
        chain_id: params.joinedProperty.chain_id,
      })
      .eq("id", onwardSearching.id);
  }

  if (onwardSale) {
    await supabase
      .from("properties")
      .update({
        linked_property_id:
          params.joinedProperty.id,
        chain_id: params.joinedProperty.chain_id,
      })
      .eq("id", onwardSale.id);
  }

  return {
    onwardSearchingId:
      onwardSearching?.id ?? null,
    onwardSaleMigrated: !!onwardSale,
  };
}

export async function relinkJoinedPropertyToSearching(
  supabase: SupabaseClient,
  joinedProperty: JoinedPropertyRef,
  searchingId: number
): Promise<
  | { ok: true; linkedSearchingId: number }
  | { ok: true; alreadyLinked: true }
  | {
      ok: false;
      reason: "downstream_link_exists";
      existingLinkedPropertyId: number;
    }
> {
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

  const { error } = await supabase
    .from("properties")
    .update({
      linked_property_id: searchingId,
    })
    .eq("id", joinedProperty.id);

  if (error) {
    throw error;
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

export function formatTopologyConflictMessage(
  existingLinkedPropertyId: number
): string {
  return (
    "This property already has a downstream link in the chain " +
    `(property #${existingLinkedPropertyId}). ` +
    "Join completed, but the Searching placeholder could not be attached " +
    "without replacing existing topology. Please review the chain or contact support."
  );
}
