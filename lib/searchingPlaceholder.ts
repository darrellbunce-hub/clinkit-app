import type { SupabaseClient } from "@supabase/supabase-js";

export type SearchingPlaceholderRef = {
  id: number;
};

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
