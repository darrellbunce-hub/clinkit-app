import PlatformAdminMfaStatusPanel from "@/components/privacyAdmin/PlatformAdminMfaStatusPanel";
import { getPlatformAdminMfaStatusAction } from "@/lib/auth/platformAdminMfaActions";

export default async function PlatformAdminMfaStatusPage() {
  const status = await getPlatformAdminMfaStatusAction();

  return (
    <PlatformAdminMfaStatusPanel
      status={
        status.ok
          ? {
              hasVerifiedTotp: status.hasVerifiedTotp,
              assuranceLevel: status.assuranceLevel,
              nextAssuranceLevel: status.nextAssuranceLevel,
              unverifiedFactorCount: status.unverifiedFactorCount,
              verifiedFactorId: status.verifiedFactorId,
            }
          : null
      }
    />
  );
}
