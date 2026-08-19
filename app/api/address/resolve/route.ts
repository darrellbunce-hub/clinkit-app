import { NextResponse } from "next/server";

import { resolveAddressForUser } from "@/lib/address/service";
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

    const id =
      body && typeof body === "object" && "id" in body
        ? (body as { id: unknown }).id
        : undefined;

    const result = await resolveAddressForUser(userId, id);
    if (!result.ok) {
      const error = publicError(result.error);
      return NextResponse.json(
        { ok: false, error },
        { status: statusForError(error) }
      );
    }

    return NextResponse.json({
      ok: true,
      address: result.address.address,
      postcode: result.address.postcode,
    });
  } catch {
    console.error("[address-lookup] resolve handler failed");
    return NextResponse.json(
      { ok: false, error: "provider_unavailable" },
      { status: 503 }
    );
  }
}
