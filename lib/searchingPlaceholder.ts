import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  isRenderableTopologyProperty,
  isSearchingPlaceholder,
  walkLinkedPropertySegment,
} from "@/lib/buildChainTopology";
export type SearchingPlaceholderRef = {
  id: number;
};

export type ConvertibleSearchingPlaceholderProperty = {
  id: number;
  linked_property_id: number | null;
  stage: string;
  address: string | null;
};

const PLACEHOLDER_RESOLUTION_SELECT =
  "id, chain_id, stage, address, postcode, linked_property_id, relationship_type";

/**
 * Canonical in-memory resolver: walk the operational sale's linked_property_id
 * graph using the same renderable property pool as buildChainTopology, then
 * return the first active searching placeholder in that segment.
 *
 * Self-healing: an unlinked user-owned searching placeholder (orphan root) is
 * intentionally not repaired here — the sale→placeholder link is ambiguous when
 * multiple purchases or segments exist. Orphans require explicit relinking.
 */
export function resolveConvertibleSearchingPlaceholder<
  T extends ConvertibleSearchingPlaceholderProperty
>(
  chainProperties: T[],
  salePropertyId: number
): SearchingPlaceholderRef | null {
  const saleProperty = chainProperties.find(
    (property) => property.id === salePropertyId
  );

  if (!saleProperty) {
    return null;
  }

  const renderableProperties = chainProperties.filter(
    isRenderableTopologyProperty
  );

  const saleInRenderable = renderableProperties.find(
    (property) => property.id === salePropertyId
  );

  if (!saleInRenderable) {
    return null;
  }

  const segment = walkLinkedPropertySegment(
    saleInRenderable,
    renderableProperties
  );

  const placeholder = segment.find((property) =>
    isSearchingPlaceholder(property)
  );

  return placeholder ? { id: placeholder.id } : null;
}

export async function resolveConvertibleSearchingPlaceholderForChain(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    salePropertyId: number;
  }
): Promise<SearchingPlaceholderRef | null> {
  const { data: chainProperties, error } =
    await supabase
      .from("properties")
      .select(PLACEHOLDER_RESOLUTION_SELECT)
      .eq("chain_id", params.chainId);

  if (error || !chainProperties) {
    console.error(error);
    return null;
  }

  return resolveConvertibleSearchingPlaceholder(
    chainProperties,
    params.salePropertyId
  );
}

export async function findSearchingPlaceholderForUser(
  supabase: SupabaseClient,
  chainId: number,
  userId: string
): Promise<SearchingPlaceholderRef | null> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("chain_id", chainId)
    .eq("stage", "searching")
    .eq("created_by_user_id", userId)
    .maybeSingle();

  return data;
}

export type AttachSearchingPlaceholderResult =
  | { ok: true; placeholderId: number; created: boolean }
  | { ok: false; error: string };

type CreateSearchingPlaceholderForSaleRpcResult = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  created?: boolean;
};

/**
 * Creates (or returns) the searching placeholder linked from a sale in one
 * transaction. Authorised via the sale; only the sale's existing homeowner
 * receives an operational identity — never an estate agent. The creator is
 * auth.uid() inside the RPC. Used by Start Move, Join Chain and EA sale
 * origination.
 *
 * Homeowners cannot insert into properties directly: properties' SELECT
 * policy cannot see a row inside its own INSERT ... RETURNING, so
 * .insert().select() is refused by RLS.
 */
export async function createSearchingPlaceholderForSale(
  supabase: SupabaseClient,
  params: {
    salePropertyId: number;
  }
): Promise<AttachSearchingPlaceholderResult> {
  const { data, error } = await supabase.rpc(
    "create_searching_placeholder_for_sale",
    {
      p_sale_property_id: params.salePropertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as CreateSearchingPlaceholderForSaleRpcResult | null;

  if (!result?.ok || result.property_id == null) {
    return {
      ok: false,
      error: result?.error ?? "searching_placeholder_create_failed",
    };
  }

  return {
    ok: true,
    placeholderId: Number(result.property_id),
    created: result.created === true,
  };
}

export type ConvertSearchingPlaceholderResult =
  | { ok: true; propertyId: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "duplicate_address"
        | "update_failed"
        | "not_authorized";
      error?: unknown;
    };

type ConvertSearchingPlaceholderRpcResult = {
  ok?: boolean;
  error?: string;
  property_id?: number;
  chain_id?: number;
};

const CONVERT_SEARCHING_PLACEHOLDER_RPC =
  "convert_searching_placeholder_for_sale";

/** Identifiers only: addresses and postcodes must not reach logs or error details. */
type ConvertRpcRequestContext = {
  chainId: number;
  salePropertyId: number;
};

/**
 * Postgres `details` can echo row values (e.g. "Failing row contains (...)" or
 * "Key (...)=(...)"), which here include the address and postcode, so only
 * the code and message are kept.
 */
function logConvertRpcTransportError(
  request: ConvertRpcRequestContext,
  error: PostgrestError
) {
  console.error(
    `[${CONVERT_SEARCHING_PLACEHOLDER_RPC}] Supabase RPC transport error`,
    {
      request,
      code: error.code ?? null,
      message: error.message ?? null,
    }
  );
}

function logConvertRpcApplicationPayload(
  request: ConvertRpcRequestContext,
  payload: unknown
) {
  console.error(
    `[${CONVERT_SEARCHING_PLACEHOLDER_RPC}] RPC application payload`,
    {
      request,
      payload,
    }
  );
}

function buildConvertFailureError(
  request: ConvertRpcRequestContext,
  options: {
    transportError?: PostgrestError;
    applicationPayload?: unknown;
  }
) {
  return {
    rpc: CONVERT_SEARCHING_PLACEHOLDER_RPC,
    request,
    transportError: options.transportError
      ? {
          code: options.transportError.code ?? null,
          message: options.transportError.message ?? null,
        }
      : undefined,
    applicationPayload: options.applicationPayload ?? null,
  };
}

function mapConvertRpcError(
  request: ConvertRpcRequestContext,
  payload: ConvertSearchingPlaceholderRpcResult | null
): ConvertSearchingPlaceholderResult {
  logConvertRpcApplicationPayload(request, payload);

  switch (payload?.error) {
    case "not_found":
      return {
        ok: false,
        reason: "not_found",
        error: buildConvertFailureError(request, {
          applicationPayload: payload,
        }),
      };
    case "duplicate_address":
      return {
        ok: false,
        reason: "duplicate_address",
        error: buildConvertFailureError(request, {
          applicationPayload: payload,
        }),
      };
    case "not_authorized":
      return {
        ok: false,
        reason: "not_authorized",
        error: buildConvertFailureError(request, {
          applicationPayload: payload,
        }),
      };
    default:
      return {
        ok: false,
        reason: "update_failed",
        error: buildConvertFailureError(request, {
          applicationPayload: payload,
        }),
      };
  }
}

/**
 * Transaction-scoped onward purchase conversion via server RPC.
 * UI gating uses resolveConvertibleSearchingPlaceholder (participant topology).
 */
export async function convertSearchingPlaceholder(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    salePropertyId: number;
    address: string;
    postcode: string;
    updatedBy?: "homeowner" | "estate_agent";
  }
): Promise<ConvertSearchingPlaceholderResult> {
  void params.updatedBy;

  const request: ConvertRpcRequestContext = {
    chainId: params.chainId,
    salePropertyId: params.salePropertyId,
  };

  const { data, error } = await supabase.rpc(
    CONVERT_SEARCHING_PLACEHOLDER_RPC,
    {
      p_sale_property_id: params.salePropertyId,
      p_address: params.address,
      p_postcode: params.postcode,
    }
  );

  if (error) {
    logConvertRpcTransportError(request, error);
    return {
      ok: false,
      reason:
        error.code === "23505" &&
        error.message === "property_address_reserved"
          ? "duplicate_address"
          : "update_failed",
      error: buildConvertFailureError(request, {
        transportError: error,
      }),
    };
  }

  const result = data as ConvertSearchingPlaceholderRpcResult | null;

  if (!result?.ok || result.property_id == null) {
    return mapConvertRpcError(request, result);
  }

  return {
    ok: true,
    propertyId: Number(result.property_id),
  };
}
