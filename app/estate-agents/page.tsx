import EaLandingPage from "@/components/estate-agents/EaLandingPage";
import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import {
  describeFoundingPublicDisplay,
  getEaFoundingAvailabilityPublicCached,
} from "@/lib/billing/eaFoundingAvailability";

export default async function EstateAgentsPage() {
  let foundingDisplay = null;
  try {
    const availability = await getEaFoundingAvailabilityPublicCached();
    foundingDisplay = describeFoundingPublicDisplay(availability);
  } catch {
    // Marketing page must still render if availability RPC is unavailable.
    foundingDisplay = null;
  }

  return (
    <EaMarketingShell>
      <EaLandingPage foundingDisplay={foundingDisplay} />
    </EaMarketingShell>
  );
}
