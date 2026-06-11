import type { SupabaseClient } from "@supabase/supabase-js";

import { isSearchingPlaceholder } from "@/lib/buildChainTopology";

type ChainPropertyRow = {
  id: number;
  chain_id: number;
  stage: string;
  address: string | null;
  postcode?: string | null;
  linked_property_id: number | null;
  relationship_type: string | null;
  buyer_connected: boolean;
  seller_connected: boolean;
  status: string;
  property_members?: {
    user_id: string;
    role: string;
  }[];
};

/**
 * After a seller joins a purchase row, connect the host participant's sale hop
 * and relink sale → purchase → prior downstream (e.g. searching placeholder).
 */
export async function establishConnectedHopAfterSellerJoinsPurchase(
  supabase: SupabaseClient,
  purchasePropertyId: number
): Promise<void> {
  const {
    data: purchaseProperty,
    error: purchaseError,
  } = await supabase
    .from("properties")
    .select(`
      *,
      property_members (
        user_id,
        role
      )
    `)
    .eq("id", purchasePropertyId)
    .single();

  if (purchaseError || !purchaseProperty) {
    console.error(purchaseError);
    return;
  }

  if (purchaseProperty.relationship_type !== "purchase") {
    return;
  }

  await supabase
    .from("properties")
    .update({
      status: "healthy",
      seller_connected: true,
      buyer_connected: true,
    })
    .eq("id", purchaseProperty.id);

  const hostBuyerUserId =
    purchaseProperty.property_members?.find(
      (member: { user_id: string; role: string }) =>
        member.role === "buyer"
    )?.user_id;

  if (!hostBuyerUserId) {
    return;
  }

  const {
    data: chainProperties,
    error: chainError,
  } = await supabase
    .from("properties")
    .select(`
      *,
      property_members (
        user_id,
        role
      )
    `)
    .eq("chain_id", purchaseProperty.chain_id);

  if (chainError || !chainProperties) {
    console.error(chainError);
    return;
  }

  const hostSaleProperty = chainProperties.find(
    (property: ChainPropertyRow) =>
      property.relationship_type === "sale" &&
      property.property_members?.some(
        (member: { user_id: string; role: string }) =>
          member.user_id === hostBuyerUserId &&
          member.role === "seller"
      )
  );

  if (!hostSaleProperty) {
    return;
  }

  const previousDownstreamId =
    hostSaleProperty.linked_property_id;

  let downstreamAfterPurchaseId:
    | number
    | null = null;

  if (
    previousDownstreamId &&
    previousDownstreamId !== purchaseProperty.id
  ) {
    const previousDownstream =
      chainProperties.find(
        (property: ChainPropertyRow) =>
          property.id === previousDownstreamId
      );

    if (
      previousDownstream &&
      isSearchingPlaceholder(previousDownstream)
    ) {
      downstreamAfterPurchaseId =
        previousDownstream.id;
    }
  }

  if (
    purchaseProperty.linked_property_id &&
    purchaseProperty.linked_property_id !==
      downstreamAfterPurchaseId
  ) {
    const existingDownstream =
      chainProperties.find(
        (property: ChainPropertyRow) =>
          property.id ===
          purchaseProperty.linked_property_id
      );

    if (
      existingDownstream &&
      isSearchingPlaceholder(existingDownstream)
    ) {
      downstreamAfterPurchaseId =
        existingDownstream.id;
    }
  }

  await supabase
    .from("properties")
    .update({
      status: "healthy",
      seller_connected: true,
      buyer_connected: true,
      linked_property_id: purchaseProperty.id,
    })
    .eq("id", hostSaleProperty.id);

  await supabase
    .from("properties")
    .update({
      status: "healthy",
      seller_connected: true,
      buyer_connected: true,
      linked_property_id:
        downstreamAfterPurchaseId,
    })
    .eq("id", purchaseProperty.id);
}
