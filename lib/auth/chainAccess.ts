import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Parses a route param as a positive integer ID.
 * Returns null for missing, non-numeric, zero, or negative values.
 */
export function parsePositiveIntParam(
  raw: string | undefined
): number | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);

  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

/**
 * True when the authenticated user is a member of any property in the chain.
 */
export async function isUserChainParticipant(
  supabase: SupabaseClient,
  chainId: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "is_chain_participant",
    { p_chain_id: chainId }
  );

  if (error) {
    return false;
  }

  return data === true;
}

/**
 * True when the user may view operational chain data (member or assigned EA).
 */
export async function isUserChainOperationalViewer(
  supabase: SupabaseClient,
  chainId: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "is_chain_operational_viewer",
    { p_chain_id: chainId }
  );

  if (error) {
    return false;
  }

  return data === true;
}

/**
 * Server route guard for chain-scoped pages.
 *
 * Used by:
 * - `/chain/[chainId]`
 * - `/buyer-ready/[chainId]`
 *
 * Calls `notFound()` for invalid IDs, unauthenticated users, and users
 * without assignment-scoped operational visibility.
 */
export async function requireChainParticipantForRoute(
  chainIdRaw: string | undefined
): Promise<number> {
  const chainId = parsePositiveIntParam(chainIdRaw);

  if (chainId === null) {
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

  const canView =
    await isUserChainOperationalViewer(
      supabase,
      chainId
    );

  if (!canView) {
    notFound();
  }

  return chainId;
}
