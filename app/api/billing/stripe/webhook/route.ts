import { NextResponse } from "next/server";

import { processStripeWebhookEvent } from "@/lib/billing/eaStripeWebhook";
import { getStripeClient } from "@/lib/billing/stripeClient";
import { getStripeServerConfig } from "@/lib/billing/stripeServerConfig";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let config;
  try {
    config = getStripeServerConfig();
  } catch {
    return NextResponse.json(
      { ok: false, error: "stripe_config_incomplete" },
      { status: 503 }
    );
  }

  if (!config.webhookConfigured || !config.webhookSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "stripe_webhook_secret_not_configured",
        message:
          "Add STRIPE_WEBHOOK_SECRET from the Stripe Sandbox endpoint configuration.",
      },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "missing_signature" },
      { status: 400 }
    );
  }

  const rawBody = await request.text();
  const stripe = getStripeClient();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_signature" },
      { status: 400 }
    );
  }

  const result = await processStripeWebhookEvent(event);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "processing_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true, duplicate: !!result.duplicate });
}
