import type { SupabaseClient } from "@supabase/supabase-js";

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
  const { data: chainProperties } = await supabase
    .from("properties")
    .select("chain_position")
    .eq("chain_id", chainId)
    .order("chain_position", { ascending: false })
    .limit(1);

  return (chainProperties?.[0]?.chain_position ?? 0) + 1;
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

  const { error: memberError } = await supabase
    .from("property_members")
    .insert({
      property_id: placeholder.id,
      user_id: params.userId,
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
    data: existingProperty,
  } = await supabase
    .from("properties")
    .select("id")
    .eq("address", params.address)
    .eq("postcode", params.postcode)
    .neq("id", placeholder.id)
    .maybeSingle();

  if (existingProperty) {
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
      updated_by: "homeowner",
    });

  if (activityError) {
    console.error(activityError);
  }

  return {
    ok: true,
    propertyId: converted.id,
  };
}
