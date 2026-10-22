"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AgentShell from "@/components/agent/AgentShell";
import HelpLink from "@/components/help/HelpLink";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";
import { completeEaManagedPropertyOrigination } from "@/lib/estateAgent/completeEaManagedPropertyOrigination";
import type { AgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import { loadAgentHomeContext } from "@/lib/estateAgent/loadAgentHomeContext";
import {
  createEaOperationalChain,
  createEaOperationalProperty,
  generateOperationalAccessCode,
  joinEaOperationalChain,
} from "@/lib/estateAgent/originateOperationalProperty";
import {
  requiresOnwardPurchaseAddress,
  resolveSellerOnwardPlan,
  saleAwaitingBuyerForOnwardPlan,
  type SellerOnwardAnswer,
} from "@/lib/estateAgent/sellerOnwardPlan";
import {
  BTN_PRIMARY_CLASS,
  SURFACE_PANEL_HOVER_CLASS,
} from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";
import PropertyAddressLookup from "@/components/address/PropertyAddressLookup";
import { formatUkPostcodeForStorage } from "@/lib/address/normalize";

type OriginateMode = "new_chain" | "join_chain";

export default function AgentOriginatePage() {
  const router = useRouter();
  const [context, setContext] =
    useState<AgentHomeContext | null>(null);
  const [isLoading, setIsLoading] =
    useState(true);
  const [isSubmitting, setIsSubmitting] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [mode, setMode] =
    useState<OriginateMode>("new_chain");
  const [saleAddress, setSaleAddress] =
    useState("");
  const [salePostcode, setSalePostcode] =
    useState("");
  const [onwardAddress, setOnwardAddress] =
    useState("");
  const [onwardPostcode, setOnwardPostcode] =
    useState("");
  const [accessCode, setAccessCode] =
    useState("");
  const [inviteEmail, setInviteEmail] =
    useState("");
  const [delegatedUpdates, setDelegatedUpdates] =
    useState(true);
  const [saleAgreed, setSaleAgreed] =
    useState<SellerOnwardAnswer | null>(null);
  const [sellerBuying, setSellerBuying] =
    useState<SellerOnwardAnswer | null>(null);
  const [offerAccepted, setOfferAccepted] =
    useState<SellerOnwardAnswer | null>(null);
  const [createdAccessCode, setCreatedAccessCode] =
    useState<string | null>(null);

  const selectedOnwardPlan = resolveSellerOnwardPlan({
    buying: sellerBuying,
    offerAccepted,
  });

  useEffect(() => {
    async function loadContext() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      const agentContext =
        await loadAgentHomeContext(
          supabase,
          user.id
        );

      setContext(agentContext);
      setIsLoading(false);
    }

    void loadContext();
  }, []);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!context) {
      return;
    }

    if (saleAgreed !== "yes") {
      setErrorMessage(
        "Add the property once the seller has agreed the sale."
      );
      return;
    }

    if (!saleAddress.trim() || !salePostcode.trim()) {
      setErrorMessage(
        "Enter the sale property address and postcode."
      );
      return;
    }

    const onwardPlan = resolveSellerOnwardPlan({
      buying: sellerBuying,
      offerAccepted,
    });

    if (!onwardPlan) {
      setErrorMessage(
        "Tell us whether the seller is buying another property."
      );
      return;
    }

    if (
      requiresOnwardPurchaseAddress(onwardPlan) &&
      (!onwardAddress.trim() ||
        !onwardPostcode.trim())
    ) {
      setErrorMessage(
        "Enter the onward purchase address and postcode."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setCreatedAccessCode(null);

    const homeownerOnlyUpdates = !delegatedUpdates;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsSubmitting(false);
      setErrorMessage("You must be signed in.");
      return;
    }

    const salePostcodeStored =
      formatUkPostcodeForStorage(salePostcode);
    const submitsOnwardAddress =
      requiresOnwardPurchaseAddress(onwardPlan);
    const onwardPostcodeStored =
      submitsOnwardAddress && onwardPostcode.trim()
        ? formatUkPostcodeForStorage(onwardPostcode)
        : "";

    let chainId: number | null = null;
    let propertyId: number | null = null;

    if (mode === "join_chain") {
      const result = await joinEaOperationalChain(
        supabase,
        {
          accessCode,
          relationshipType: "sale",
          address: saleAddress,
          postcode: salePostcodeStored,
          branchId: context.branch.id,
          homeownerOnlyUpdates,
          inviteEmail: inviteEmail || null,
          awaitingBuyer:
            saleAwaitingBuyerForOnwardPlan(
              onwardPlan
            ),
        }
      );

      if (result.error === "property_already_exists") {
        // An access code and address never give the branch the seller side;
        // the seller connects and appoints the branch.
        setIsSubmitting(false);
        setErrorMessage(
          "This property is already part of MoveLoop. If you act for its seller, the seller needs to connect to the property and appoint your branch. Check the chain access code and address."
        );
        return;
      } else if (result.error || result.propertyId == null) {
        setIsSubmitting(false);
        setErrorMessage(
          result.error ??
            "Could not join the chain."
        );
        return;
      } else {
        chainId = result.chainId;
        propertyId = result.propertyId;
      }
    } else {
      let chainAccessCode =
        generateOperationalAccessCode();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const chainResult =
          await createEaOperationalChain(supabase, {
            name: `EA-CHAIN-${Date.now()}`,
            accessCode: chainAccessCode,
          });

        if (
          chainResult.error ===
            "duplicate_access_code" &&
          attempt < 4
        ) {
          chainAccessCode =
            generateOperationalAccessCode();
          continue;
        }

        if (chainResult.error || chainResult.chainId == null) {
          setIsSubmitting(false);
          setErrorMessage(
            chainResult.error ??
              "Could not create the chain."
          );
          return;
        }

        chainId = chainResult.chainId;
        chainAccessCode =
          chainResult.accessCode ?? chainAccessCode;
        break;
      }

      if (chainId == null) {
        setIsSubmitting(false);
        setErrorMessage(
          "Could not create the chain."
        );
        return;
      }

      const propertyResult =
        await createEaOperationalProperty(supabase, {
          chainId,
          relationshipType: "sale",
          address: saleAddress,
          postcode: salePostcodeStored,
          branchId: context.branch.id,
          homeownerOnlyUpdates,
          inviteEmail: inviteEmail || null,
          awaitingBuyer:
            saleAwaitingBuyerForOnwardPlan(
              onwardPlan
            ),
        });

      if (
        propertyResult.error ||
        propertyResult.propertyId == null
      ) {
        const { error: cleanupError } = await supabase.rpc(
          "cleanup_abandoned_onboarding_chain",
          {
            p_chain_id: chainId,
            p_require_empty: true,
          }
        );

        if (cleanupError) {
          console.error(
            "[agent-originate] empty chain cleanup failed:",
            cleanupError.message
          );
        }

        setIsSubmitting(false);
        setErrorMessage(
          propertyResult.error === "property_already_exists"
            ? "This property is already part of MoveLoop. If it is a buyer's purchase awaiting its seller, use Join with the chain access code."
            : propertyResult.error ??
                "Could not create the property."
        );
        return;
      }

      propertyId = propertyResult.propertyId;
      setCreatedAccessCode(chainAccessCode);
    }

    const completionResult =
      await completeEaManagedPropertyOrigination(
        supabase,
        {
          chainId: chainId!,
          salePropertyId: propertyId!,
          userId: user.id,
          branchId: context.branch.id,
          homeownerOnlyUpdates,
          onwardPlan,
          onwardAddress: submitsOnwardAddress
            ? onwardAddress
            : "",
          onwardPostcode: onwardPostcodeStored,
        }
      );

    setIsSubmitting(false);

    if (!completionResult.ok) {
      setErrorMessage(completionResult.error);
      return;
    }

    router.push(`/property/${propertyId}`);
  }

  return (
    <AgentShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        {isLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
            Loading...
          </div>
        ) : !context ? (
          <div className="rounded-3xl border border-red-200 bg-white p-10 text-center text-red-800 shadow-sm">
            We could not load your branch context.
          </div>
        ) : (
          <div className="space-y-8">
            <div>
              <Link
                href={ROUTES.agentHome}
                className={`text-sm font-medium text-slate-600 ${SURFACE_PANEL_HOVER_CLASS}`}
              >
                ← Back to command centre
              </Link>

              <h1
                className={`mt-4 ${PAGE_TITLE_CLASS}`}
              >
                Add Managed Property
              </h1>

              <p className="mt-3 text-slate-600">
                Create a property and begin managing the
                transaction immediately. If the homeowner
                later joins MoveLoop, they can connect their
                property without affecting the chain.
              </p>

              <div className="mt-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span
                  className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
                  aria-hidden="true"
                >
                  i
                </span>

                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    Homeowner connection
                  </p>

                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    You can manage this property immediately.
                    If the homeowner later joins MoveLoop they
                    can connect their property without affecting
                    the existing chain or transaction.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ModeButton
                active={mode === "new_chain"}
                label="Create Chain"
                onClick={() =>
                  setMode("new_chain")
                }
              />

              <ModeButton
                active={mode === "join_chain"}
                label="Join Existing Chain"
                onClick={() =>
                  setMode("join_chain")
                }
              />
            </div>

            <form
              onSubmit={handleSubmit}
              className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${CARD_PADDING_CLASS} space-y-6`}
            >
              <YesNoField
                legend="Has the seller agreed the sale?"
                hint="The sale is agreed once the seller has accepted an offer from a buyer."
                value={saleAgreed}
                yesLabel="Yes, the sale is agreed"
                noLabel="Not yet"
                onAnswer={(value) => {
                  setSaleAgreed(value);
                  setErrorMessage("");
                }}
              />

              {saleAgreed === "no" ? (
                <div
                  role="note"
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700"
                >
                  <p className="font-medium text-slate-900">
                    It&apos;s a little early to add this property
                  </p>
                  <p className="mt-2">
                    MoveLoop keeps track of a property move once
                    the sale has been agreed. If the seller is
                    still preparing to sell or hasn&apos;t
                    accepted an offer yet, there&apos;s nothing
                    to add just now.
                  </p>
                  <p className="mt-2">
                    Come back when the sale has been agreed, and
                    add the property then.
                  </p>
                </div>
              ) : null}

              {saleAgreed === "yes" ? (
                <>
              {mode === "join_chain" ? (
                <Field
                  label="Chain access code"
                  value={accessCode}
                  onChange={setAccessCode}
                  required
                />
              ) : null}

              <PropertyAddressLookup
                idPrefix="ea-originate-sale"
                label="Sale address"
                address={saleAddress}
                postcode={salePostcode}
                onAddressChange={setSaleAddress}
                onPostcodeChange={setSalePostcode}
              />

              <Field
                label="Invitation email (optional)"
                value={inviteEmail}
                onChange={setInviteEmail}
                type="email"
                hint="Used only to send a future invitation if the homeowner chooses to join MoveLoop."
              />

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-4">
                <input
                  type="checkbox"
                  checked={delegatedUpdates}
                  onChange={(event) =>
                    setDelegatedUpdates(
                      event.target.checked
                    )
                  }
                  className="mt-1"
                />

                <span>
                  <span className="block font-medium text-slate-900">
                    Operational editing enabled
                  </span>

                  <span className="mt-1 block text-sm text-slate-600">
                    Your branch manages this transaction
                    until the homeowner connects. Leave this
                    enabled to keep making updates afterwards;
                    uncheck it if the homeowner should make
                    updates once they connect. The homeowner
                    can change this later.
                  </span>
                </span>
              </label>

              <YesNoField
                legend="Is the seller buying, or will they be buying, a property?"
                value={sellerBuying}
                yesLabel="Yes"
                noLabel="No"
                onAnswer={(value) => {
                  setSellerBuying(value);
                  setErrorMessage("");
                }}
              />

              {sellerBuying === "yes" ? (
                <YesNoField
                  legend="Has the seller had an offer accepted on the property they are buying?"
                  value={offerAccepted}
                  yesLabel="Yes, their offer has been accepted"
                  noLabel="Not yet"
                  onAnswer={(value) => {
                    setOfferAccepted(value);
                    setErrorMessage("");
                  }}
                />
              ) : null}

              {selectedOnwardPlan === "searching" ? (
                <p className="text-sm text-slate-600">
                  Until the seller has an offer accepted, their
                  onward purchase will show as Searching in the
                  chain.
                </p>
              ) : null}

              {selectedOnwardPlan === "no_onward" ? (
                <p className="text-sm text-slate-600">
                  The chain will show this sale with no onward
                  purchase.
                </p>
              ) : null}

              {selectedOnwardPlan &&
              requiresOnwardPurchaseAddress(
                selectedOnwardPlan
              ) ? (
                <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <PropertyAddressLookup
                    idPrefix="ea-originate-onward"
                    label="Onward purchase address"
                    address={onwardAddress}
                    postcode={onwardPostcode}
                    onAddressChange={setOnwardAddress}
                    onPostcodeChange={setOnwardPostcode}
                  />
                </div>
              ) : null}
                </>
              ) : null}

              {errorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <p>{errorMessage}</p>
                  <p className="mt-2">
                    Need help?{" "}
                    <HelpLink
                      newTab
                      className="font-medium text-red-900 underline underline-offset-2 hover:text-red-950"
                    />
                  </p>
                </div>
              ) : null}

              {createdAccessCode ? (
                <p className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                  Chain access code:{" "}
                  <strong>{createdAccessCode}</strong>
                </p>
              ) : null}

              {saleAgreed === "yes" ? (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full rounded-xl px-6 py-4 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_PRIMARY_CLASS}`}
                >
                  {isSubmitting
                    ? "Adding..."
                    : "Add Managed Property"}
                </button>
              ) : null}
            </form>
          </div>
        )}
      </section>
    </AgentShell>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-4 text-sm font-semibold transition ${
        active
          ? "border-brand-primary bg-brand-primary/10 text-slate-900"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function YesNoField({
  legend,
  hint,
  value,
  yesLabel,
  noLabel,
  onAnswer,
}: {
  legend: string;
  hint?: string;
  value: SellerOnwardAnswer | null;
  yesLabel: string;
  noLabel: string;
  onAnswer: (value: SellerOnwardAnswer) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-900">
        {legend}
      </legend>

      {hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ModeButton
          active={value === "yes"}
          label={yesLabel}
          onClick={() => onAnswer("yes")}
        />
        <ModeButton
          active={value === "no"}
          label={noLabel}
          onClick={() => onAnswer("no")}
        />
      </div>
    </fieldset>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        required={required}
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900"
      />

      {hint ? (
        <span className="mt-2 block text-xs text-slate-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
