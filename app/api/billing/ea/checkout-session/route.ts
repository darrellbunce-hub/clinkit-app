import { NextResponse } from "next/server";

import { requireEaBranchBillingOwner } from "@/lib/billing/eaBillingAuth";
import {
  createEaBranchCheckoutSession,
  type EaCheckoutReturnFlow,
} from "@/lib/billing/eaCheckout";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = {
  branchId?: string;
  /** Allowlisted return destination only: "account" | "onboarding". */
  returnFlow?: string;
};

function parseReturnFlow(
  value: unknown
): EaCheckoutReturnFlow | null {
  if (value === undefined || value === null || value === "") {
    return "account";
  }
  if (value === "account" || value === "onboarding") {
    return value;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const branchId = body.branchId?.trim();
    if (!branchId) {
      return NextResponse.json(
        { ok: false, error: "branch_required" },
        { status: 400 }
      );
    }

    const returnFlow = parseReturnFlow(body.returnFlow);
    if (!returnFlow) {
      return NextResponse.json(
        { ok: false, error: "invalid_return_flow" },
        { status: 400 }
      );
    }

    // Reject any client-supplied commercial fields if present
    const forbidden = [
      "priceId",
      "price_id",
      "amount",
      "tier",
      "pricingTier",
      "customerId",
      "subscriptionId",
      "stripePriceId",
      "foundingSlot",
      "slotNumber",
      "idempotencyKey",
      "idempotency_key",
      "checkoutAttemptKey",
      "checkoutAttemptId",
      "trialPeriodDays",
      "trial_period_days",
      "successUrl",
      "cancelUrl",
      "success_url",
      "cancel_url",
    ];
    for (const key of forbidden) {
      if (key in (body as Record<string, unknown>)) {
        return NextResponse.json(
          { ok: false, error: "client_price_authority_forbidden" },
          { status: 400 }
        );
      }
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const authz = await requireEaBranchBillingOwner(supabase, user, branchId);
    if (!authz.ok) {
      return NextResponse.json(
        { ok: false, error: authz.error },
        { status: authz.status }
      );
    }

    const result = await createEaBranchCheckoutSession({
      context: authz.context,
      returnFlow,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      url: result.url,
      pricingTier: result.pricingTier,
      trialPeriodDays: result.trialPeriodDays,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "checkout_unavailable" },
      { status: 503 }
    );
  }
}
