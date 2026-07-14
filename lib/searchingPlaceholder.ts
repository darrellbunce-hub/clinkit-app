import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import {
  isSearchingPlaceholder,
  walkLinkedPropertySegment,
} from "@/lib/buildChainTopology";
import {
  establishOperationalHomeowner,
  OPERATIONAL_IDENTITY_GRANT_VIA,
} from "@/lib/ownership/grants";

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
    (property) =>
      !!property.address ||
      isSearchingPlaceholder(property)
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

export async function getNextChainPosition(
  supabase: SupabaseClient,
  chainId: number
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "get_next_chain_position",
    {
      p_chain_id: chainId,
    }
  );

  if (error || data == null) {
    console.error(error);
    return 1;
  }

  return Number(data);
}

export async function insertSearchingPlaceholder(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    userId: string;
    chainPosition?: number;
  }
): Promise<{
  placeholder: SearchingPlaceholderRef | null;
  error: unknown | null;
}> {
  const chainPosition =
    params.chainPosition ??
    (await getNextChainPosition(
      supabase,
      params.chainId
    ));

  const {
    data: placeholder,
    error,
  } = await supabase
    .from("properties")
    .insert({
      chain_id: params.chainId,
      chain_position: chainPosition,
      stage: "searching",
      address: null,
      postcode: null,
      relationship_type: "purchase",
      status: "pending_connection",
      created_by_user_id: params.userId,
      linked_property_id: null,
      awaiting_buyer: false,
      buyer_connected: false,
      seller_connected: true,
      is_searching: true,
      is_current_user: true,
      last_updated_days: 0,
    })
    .select("id")
    .single();

  if (error || !placeholder) {
    return {
      placeholder: null,
      error: error ?? new Error("Searching placeholder insert failed"),
    };
  }

  const { data: grant, error: memberError } =
    await establishOperationalHomeowner(supabase, {
      propertyId: placeholder.id,
      grantedVia: OPERATIONAL_IDENTITY_GRANT_VIA.startMove,
    });

  if (memberError || !grant.ok) {
    return {
      placeholder: null,
      error:
        memberError ??
        new Error(!grant.ok ? grant.error : "grant_failed"),
    };
  }

  return {
    placeholder,
    error: null,
  };
}

export async function linkSaleToSearchingPlaceholder(
  supabase: SupabaseClient,
  params: {
    salePropertyId: number;
    searchingPropertyId: number;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "link_sale_to_searching_placeholder",
    {
      p_sale_property_id: params.salePropertyId,
      p_searching_property_id:
        params.searchingPropertyId,
    }
  );

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  const result = data as { ok?: boolean; error?: string } | null;

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error ?? "link_failed",
    };
  }

  return { ok: true };
}

export type AttachSearchingPlaceholderResult =
  | { ok: true; placeholderId: number }
  | { ok: false; error: string };

/**
 * Inserts a searching placeholder and links it from the sale — shared by
 * Start Move and EA sale origination.
 */
export async function attachSearchingPlaceholderToSale(
  supabase: SupabaseClient,
  params: {
    chainId: number;
    salePropertyId: number;
    userId: string;
  }
): Promise<AttachSearchingPlaceholderResult> {
  const existingPlaceholder =
    await resolveConvertibleSearchingPlaceholderForChain(
      supabase,
      {
        chainId: params.chainId,
        salePropertyId: params.salePropertyId,
      }
    );

  if (existingPlaceholder) {
    return {
      ok: true,
      placeholderId: existingPlaceholder.id,
    };
  }

  const {
    placeholder,
    error: insertError,
  } = await insertSearchingPlaceholder(supabase, {
    chainId: params.chainId,
    userId: params.userId,
  });

  if (insertError || !placeholder) {
    return {
      ok: false,
      error:
        insertError instanceof Error
          ? insertError.message
          : "searching_placeholder_insert_failed",
    };
  }

  const linkResult =
    await linkSaleToSearchingPlaceholder(supabase, {
      salePropertyId: params.salePropertyId,
      searchingPropertyId: placeholder.id,
    });

  if (!linkResult.ok) {
    return {
      ok: false,
      error: linkResult.error,
    };
  }

  return {
    ok: true,
    placeholderId: placeholder.id,
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

type ConvertRpcRequestContext = {
  chainId: number;
  salePropertyId: number;
  address: string;
  postcode: string;
};

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
      details: error.details ?? null,
      hint: error.hint ?? null,
      error,
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
          details: options.transportError.details ?? null,
          hint: options.transportError.hint ?? null,
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
    address: params.address,
    postcode: params.postcode,
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
      reason: "update_failed",
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
