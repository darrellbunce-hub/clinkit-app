"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ClaimInvitationError from "@/components/claim/ClaimInvitationError";
import ClaimPropertyExperience from "@/components/claim/ClaimPropertyExperience";
import Navbar from "@/components/Navbar";
import PageHeaderBand from "@/components/theme/PageHeaderBand";
import { useChain } from "@/context/ChainContext";
import { ROUTES } from "@/lib/auth/routes";
import {
  discoverClaimableProperties,
  filterClaimableProperties,
} from "@/lib/propertyClaim/discoverClaimableProperties";
import { resolveClaimInvitationToken } from "@/lib/propertyClaim/propertyInvitations";
import type { ClaimablePropertySummary } from "@/lib/propertyClaim/types";
import { PAGE_BG_CLASS } from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

function ClaimPropertyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshParticipantData } = useChain();

  const [properties, setProperties] =
    useState<ClaimablePropertySummary[] | null>(
      null
    );
  const [invitationToken, setInvitationToken] =
    useState<string | null>(null);
  const [tokenError, setTokenError] =
    useState<string | null>(null);
  const [isLoading, setIsLoading] =
    useState(true);

  const highlightPropertyId = parseOptionalPropertyId(
    searchParams.get("propertyId")
  );
  const tokenParam = searchParams.get("token");

  useEffect(() => {
    async function loadClaimEntry() {
      setIsLoading(true);
      setTokenError(null);
      setInvitationToken(null);

      if (tokenParam) {
        const resolved =
          await resolveClaimInvitationToken(
            supabase,
            tokenParam
          );

        if (!resolved.ok) {
          setProperties([]);
          setTokenError(resolved.error);
          setIsLoading(false);
          return;
        }

        setProperties([resolved.property]);
        setInvitationToken(tokenParam);
        setIsLoading(false);
        return;
      }

      const claimable =
        await discoverClaimableProperties(
          supabase
        );

      const filtered = filterClaimableProperties(
        claimable,
        highlightPropertyId
      );

      setProperties(filtered);
      setIsLoading(false);

      if (
        claimable.length === 0 &&
        highlightPropertyId == null
      ) {
        router.replace(ROUTES.homeownerDashboard);
      }
    }

    void loadClaimEntry();
  }, [
    highlightPropertyId,
    router,
    tokenParam,
  ]);

  async function handleClaimComplete({
    propertyId,
  }: {
    propertyId: number;
    chainId: number;
  }) {
    await refreshParticipantData();
    router.push(`/property/${propertyId}`);
  }

  return (
    <main className={PAGE_BG_CLASS}>
      <Navbar />
      <PageHeaderBand />

      <section className="max-w-2xl mx-auto px-6 py-12">
        {isLoading || properties == null ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
            Checking for managed properties...
          </div>
        ) : tokenError ? (
          <ClaimInvitationError error={tokenError} />
        ) : (
          <ClaimPropertyExperience
            initialProperties={properties}
            highlightPropertyId={
              highlightPropertyId
            }
            invitationToken={invitationToken}
            onClaimComplete={
              handleClaimComplete
            }
          />
        )}
      </section>
    </main>
  );
}

export default function ClaimPropertyPage() {
  return (
    <Suspense
      fallback={
        <main className={PAGE_BG_CLASS}>
          <Navbar />
          <PageHeaderBand />

          <section className="max-w-2xl mx-auto px-6 py-12">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
              Checking for managed properties...
            </div>
          </section>
        </main>
      }
    >
      <ClaimPropertyContent />
    </Suspense>
  );
}

function parseOptionalPropertyId(
  value: string | null
): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}
