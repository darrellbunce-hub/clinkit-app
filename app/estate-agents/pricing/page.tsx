import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/auth/routes";

/** Pricing is on the EA marketing page — this route resolves broken /estate-agents/pricing links. */
export default function EstateAgentPricingPage() {
  redirect(`${ROUTES.estateAgentMarketing}#pricing`);
}
