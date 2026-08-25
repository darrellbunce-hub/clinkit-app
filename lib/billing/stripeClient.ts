import "server-only";

import Stripe from "stripe";

import { getStripeServerConfig } from "@/lib/billing/stripeServerConfig";

let stripeSingleton: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (stripeSingleton) return stripeSingleton;
  const config = getStripeServerConfig();
  stripeSingleton = new Stripe(config.secretKey);
  return stripeSingleton;
}
