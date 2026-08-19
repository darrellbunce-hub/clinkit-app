import { NextResponse } from "next/server";

import { resolveAddressForUser, suggestAddressesForUser } from "@/lib/address/service";
import type { AddressLookupErrorCode } from "@/lib/address/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function statusForError(error: AddressLookupErrorCode): number {
  switch (error) {
    case "unauthorized":
      return 401;
    case "invalid_request":
    case "query_too_short":
    case "query_too_long":
      return 400;
    case "rate_limited":
      return 429;
    case "not_found":
      return 404;
    case "misconfigured":
    case "provider_unavailable":
    case "provider_timeout":
    default:
      return 503;
  }
}

function publicError(error: AddressLookupErrorCode): AddressLookupErrorCode {
  // Never surface provider/internal detail beyond stable codes.
  if (
    error === "provider_unavailable" ||
    error === "provider_timeout" ||
    error === "misconfigured"
  ) {
    return "provider_unavailable";
  }
  return error;
}

async function requireUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_request" },
        { status: 400 }
      );
    }

    const query =
      body && typeof body === "object" && "query" in body
        ? (body as { query: unknown }).query
        : undefined;

    const result = await suggestAddressesForUser(userId, query);
    if (!result.ok) {
      const error = publicError(result.error);
      return NextResponse.json(
        { ok: false, error },
        { status: statusForError(error) }
      );
    }

    return NextResponse.json({
      ok: true,
      suggestions: result.suggestions,
    });
  } catch {
    console.error("[address-lookup] suggest handler failed");
    return NextResponse.json(
      { ok: false, error: "provider_unavailable" },
      { status: 503 }
    );
  }
}
