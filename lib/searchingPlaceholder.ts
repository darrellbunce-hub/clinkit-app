import type { SupabaseClient } from "@supabase/supabase-js";

import { ensurePropertyMembership } from "@/lib/ensurePropertyMembership";

export type SearchingPlaceholderRef = {
  id: number;
};

export async function findSearchingPlaceholderBySaleProperty(
  supabase: SupabaseClient,
  chainId: number,
  salePropertyId: number
): Promise<SearchingPlaceholderRef | null> {
  const { data: saleProperty } = await supabase
    .from("properties")
    .select("linked_property_id")
    .eq("id", salePropertyId)
    .eq("chain_id", chainId)
    .maybeSingle();

  if (!saleProperty?.linked_property_id) {
    return null;
  }

  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", saleProperty.linked_property_id)
    .eq("chain_id", chainId)
    .eq("stage", "searching")
    .is("address", null)
    .maybeSingle();

  return data;
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

  const { error: memberError } =
    await ensurePropertyMembership(supabase, {
      propertyId: placeholder.id,
      role: "buyer",
    });

  if (memberError) {
    return {
      placeholder: null,
      error: memberError,
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
    await findSearchingPlaceholderBySaleProperty(
      supabase,
      params.chainId,
      params.salePropertyId
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
        | "update_failed";
      error?: unknown;
    };

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
  const placeholder =
    await findSearchingPlaceholderBySaleProperty(
      supabase,
      params.chainId,
      params.salePropertyId
    );

  if (!placeholder) {
    return { ok: false, reason: "not_found" };
  }

  const {
    data: addressExists,
    error: existsError,
  } = await supabase.rpc(
    "property_exists_for_onboarding",
    {
      p_address: params.address,
      p_postcode: params.postcode,
      p_exclude_property_id: placeholder.id,
    }
  );

  if (existsError) {
    console.error(existsError);
  }

  if (addressExists) {
    return {
      ok: false,
      reason: "duplicate_address",
    };
  }

  const {
    data: converted,
    error: updateError,
  } = await supabase
    .from("properties")
    .update({
      stage: "offer_accepted",
      address: params.address,
      postcode: params.postcode,
      status: "pending_connection",
      relationship_type: "purchase",
      buyer_connected: true,
      seller_connected: false,
      is_searching: false,
      is_current_user: true,
      awaiting_buyer: false,
    })
    .eq("id", placeholder.id)
    .eq("stage", "searching")
    .is("address", null)
    .is("postcode", null)
    .select("id")
    .single();

  if (updateError || !converted) {
    return {
      ok: false,
      reason: "update_failed",
      error: updateError,
    };
  }

  const { error: activityError } =
    await supabase.from("activities").insert({
      property_id: converted.id,
      update: "Onward purchase added",
      updated_by: params.updatedBy ?? "homeowner",
    });

  if (activityError) {
    console.error(activityError);
  }

  return {
    ok: true,
    propertyId: converted.id,
  };
}
