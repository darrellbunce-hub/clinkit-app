"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { AUTH_TITLE_CLASS } from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";
import { isEstateAgent } from "@/lib/accountType";
import {
  acceptEaBranchInvitation,
  formatEaBranchInvitationError,
  previewEaBranchInvitation,
  type EaBranchInvitationPreview,
} from "@/lib/estateAgent/branchTeam";
import { formatEaBranchMemberRoleLabel } from "@/lib/estateAgent/branchTeamPresentation";
import { bootstrapAuthenticatedEstateAgentProfile } from "@/lib/estateAgent/flushPendingEstateAgentProfile";
import { fetchAuthenticatedProfileAccountFields } from "@/lib/currentUserContext";
import { flushPendingSignupLegalAcceptance } from "@/lib/legal/recordSignupLegalAcceptance";
import { supabase } from "@/lib/supabase";

function JoinBranchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [preview, setPreview] =
    useState<EaBranchInvitationPreview | null>(null);
  const [previewError, setPreviewError] =
    useState<string | null>(null);
  const [actionError, setActionError] =
    useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] =
    useState(false);
  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);
  const [isEstateAgentAccount, setIsEstateAgentAccount] =
    useState(false);

  const [hasAttemptedAutoAccept, setHasAttemptedAutoAccept] =
    useState(false);

  useEffect(() => {
    async function loadJoinState() {
      setIsLoading(true);
      setPreviewError(null);
      setActionError(null);

      if (!token) {
        setPreviewError("invitation_not_found");
        setIsLoading(false);
        return;
      }

      const previewResult =
        await previewEaBranchInvitation(
          supabase,
          token
        );

      if (!previewResult.ok) {
        setPreviewError(previewResult.error);
        setIsLoading(false);
        return;
      }

      setPreview(previewResult.preview);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setCurrentUserId(user.id);

        const profileBootstrap =
          await bootstrapAuthenticatedEstateAgentProfile(
            supabase
          );

        if (profileBootstrap.ok) {
          await flushPendingSignupLegalAcceptance(supabase);
        }

        const profile =
          await fetchAuthenticatedProfileAccountFields(
            supabase,
            user.id
          );

        setIsEstateAgentAccount(
          isEstateAgent(profile)
        );
      }

      setIsLoading(false);
    }

    void loadJoinState();
  }, [token]);

  useEffect(() => {
    if (
      !token ||
      !preview ||
      !currentUserId ||
      !isEstateAgentAccount ||
      isAccepting ||
      hasAttemptedAutoAccept
    ) {
      return;
    }

    setHasAttemptedAutoAccept(true);
    void handleAcceptInvitation();
  }, [
    token,
    preview,
    currentUserId,
    isEstateAgentAccount,
    isAccepting,
    hasAttemptedAutoAccept,
  ]);

  async function handleAcceptInvitation() {
    if (!token) {
      return;
    }

    setActionError(null);
    setIsAccepting(true);

    const result = await acceptEaBranchInvitation(
      supabase,
      token
    );

    setIsAccepting(false);

    if (!result.ok) {
      if (result.error === "already_branch_member") {
        router.replace(ROUTES.agentHome);
        return;
      }

      setActionError(
        formatEaBranchInvitationError(result.error)
      );
      return;
    }

    router.replace(ROUTES.agentHome);
  }

  const joinDestination = token
    ? `${ROUTES.estateAgentJoin}?token=${encodeURIComponent(token)}`
    : ROUTES.estateAgentJoin;

  const signupHref = `${ROUTES.estateAgentSignup}?token=${encodeURIComponent(token ?? "")}`;
  const loginHref = `${ROUTES.estateAgentLogin}?next=${encodeURIComponent(joinDestination)}`;

  if (isLoading) {
    return (
      <EaMarketingShell>
        <section className="max-w-xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
            Checking invitation...
          </div>
        </section>
      </EaMarketingShell>
    );
  }

  if (previewError || !preview) {
    return (
      <EaMarketingShell>
        <section className="max-w-xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <h1 className={AUTH_TITLE_CLASS}>
              Invitation unavailable
            </h1>

            <p className="mt-3 text-slate-600">
              {formatEaBranchInvitationError(
                previewError ?? "invitation_not_found"
              )}
            </p>

            <p className="mt-6 text-sm text-slate-600">
              Ask your branch owner to send a new invitation.
            </p>
          </div>
        </section>
      </EaMarketingShell>
    );
  }

  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <h1 className={AUTH_TITLE_CLASS}>
            Join {preview.companyName}
          </h1>

          <p className="mt-3 text-slate-600">
            You&apos;ve been invited to join{" "}
            <span className="font-semibold text-slate-900">
              {preview.branchName}
            </span>{" "}
            at{" "}
            <span className="font-semibold text-slate-900">
              {preview.companyName}
            </span>{" "}
            on Keynetic.
          </p>

          <dl className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm">
            <div>
              <dt className="font-medium text-slate-500">
                Name
              </dt>
              <dd className="mt-1 text-slate-900">
                {preview.inviteName}
              </dd>
            </div>

            <div>
              <dt className="font-medium text-slate-500">
                Email
              </dt>
              <dd className="mt-1 text-slate-900 break-words">
                {preview.inviteEmail}
              </dd>
            </div>

            <div>
              <dt className="font-medium text-slate-500">
                Role
              </dt>
              <dd className="mt-1 text-slate-900">
                {formatEaBranchMemberRoleLabel(
                  preview.inviteRole
                )}
              </dd>
            </div>
          </dl>

          {actionError ? (
            <p
              role="alert"
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              {actionError}
            </p>
          ) : null}

          {currentUserId ? (
            isEstateAgentAccount ? (
              <button
                type="button"
                disabled={isAccepting}
                onClick={() =>
                  void handleAcceptInvitation()
                }
                className="mt-6 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400"
              >
                {isAccepting
                  ? "Joining branch..."
                  : "Accept invitation"}
              </button>
            ) : (
              <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Sign in with an estate agent account that
                matches{" "}
                <span className="font-semibold">
                  {preview.inviteEmail}
                </span>
                .
              </p>
            )
          ) : (
            <div className="mt-6 space-y-3">
              <Link
                href={signupHref}
                className="block w-full rounded-2xl bg-slate-900 py-4 text-center font-semibold text-white"
              >
                Create account
              </Link>

              <Link
                href={loginHref}
                className="block w-full rounded-2xl border border-slate-300 py-4 text-center font-semibold text-slate-900"
              >
                Log in
              </Link>
            </div>
          )}

          <p className="mt-6 text-sm text-slate-600">
            Invitation expires{" "}
            {new Date(
              preview.expiresAt
            ).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .
          </p>
        </div>
      </section>
    </EaMarketingShell>
  );
}

export default function EstateAgentJoinPage() {
  return (
    <Suspense
      fallback={
        <EaMarketingShell>
          <section className="max-w-xl mx-auto px-6 py-16">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
              Checking invitation...
            </div>
          </section>
        </EaMarketingShell>
      }
    >
      <JoinBranchContent />
    </Suspense>
  );
}
