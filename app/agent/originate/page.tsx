"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AgentShell from "@/components/agent/AgentShell";
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
  DEFAULT_SELLER_ONWARD_PLAN,
  requiresOnwardPurchaseAddress,
  saleAwaitingBuyerForOnwardPlan,
  type SellerOnwardPlan,
} from "@/lib/estateAgent/sellerOnwardPlan";
import {
  BTN_PRIMARY_CLASS,
  SURFACE_PANEL_HOVER_CLASS,
} from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

type OriginateMode = "new_chain" | "join_chain";

const ONWARD_PLAN_OPTIONS: {
  value: SellerOnwardPlan;
  label: string;
}[] = [
  {
    value: "searching",
    label: "Searching for next property",
  },
  {
    value: "purchase_agreed",
    label: "Purchase agreed",
  },
  {
    value: "no_onward",
    label: "No onward purchase",
  },
];

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
  const [onwardPlan, setOnwardPlan] =
    useState<SellerOnwardPlan>(
      DEFAULT_SELLER_ONWARD_PLAN
    );
  const [createdAccessCode, setCreatedAccessCode] =
    useState<string | null>(null);

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

    let chainId: number | null = null;
    let propertyId: number | null = null;

    if (mode === "join_chain") {
      const result = await joinEaOperationalChain(
        supabase,
        {
          accessCode,
          relationshipType: "sale",
          address: saleAddress,
          postcode: salePostcode,
          branchId: context.branch.id,
          homeownerOnlyUpdates,
          inviteEmail: inviteEmail || null,
          awaitingBuyer:
            saleAwaitingBuyerForOnwardPlan(
              onwardPlan
            ),
        }
      );

      if (result.error || result.propertyId == null) {
        setIsSubmitting(false);
        setErrorMessage(
          result.error ??
            "Could not join the chain."
        );
        return;
      }

      chainId = result.chainId;
      propertyId = result.propertyId;
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
          postcode: salePostcode,
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
        setIsSubmitting(false);
        setErrorMessage(
          propertyResult.error ??
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
          onwardAddress,
          onwardPostcode,
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
                later joins Keynetic, they can claim the
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
                    Homeowner claiming
                  </p>

                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    You can manage this property immediately.
                    If the homeowner later joins Keynetic they
                    can claim the property without affecting
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
              {mode === "join_chain" ? (
                <Field
                  label="Chain access code"
                  value={accessCode}
                  onChange={setAccessCode}
                  required
                />
              ) : null}

              <Field
                label="Sale address"
                value={saleAddress}
                onChange={setSaleAddress}
                required
              />

              <Field
                label="Postcode"
                value={salePostcode}
                onChange={setSalePostcode}
                required
              />

              <Field
                label="Invitation email (optional)"
                value={inviteEmail}
                onChange={setInviteEmail}
                type="email"
                hint="Used only to send a future claim invitation if the homeowner chooses to join Keynetic."
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
                    Enabled by default so your branch can
                    manage this transaction immediately.
                    Uncheck only if you want view-only
                    access until the homeowner claims.
                  </span>
                </span>
              </label>

              <fieldset className="space-y-3 rounded-2xl border border-slate-200 px-4 py-4">
                <legend className="px-1 text-sm font-medium text-slate-900">
                  Seller&apos;s onward plans
                </legend>

                {ONWARD_PLAN_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-3"
                  >
                    <input
                      type="radio"
                      name="onwardPlan"
                      value={option.value}
                      checked={
                        onwardPlan === option.value
                      }
                      onChange={() => {
                        setOnwardPlan(option.value);
                        if (
                          option.value !==
                          "purchase_agreed"
                        ) {
                          setOnwardAddress("");
                          setOnwardPostcode("");
                        }
                      }}
                      className="mt-1"
                    />

                    <span className="text-sm text-slate-700">
                      {option.label}
                    </span>
                  </label>
                ))}
              </fieldset>

              {requiresOnwardPurchaseAddress(
                onwardPlan
              ) ? (
                <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-900">
                    Onward purchase address
                  </p>

                  <Field
                    label="Address"
                    value={onwardAddress}
                    onChange={setOnwardAddress}
                    required
                  />

                  <Field
                    label="Postcode"
                    value={onwardPostcode}
                    onChange={setOnwardPostcode}
                    required
                  />
                </div>
              ) : null}

              {errorMessage ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {errorMessage}
                </p>
              ) : null}

              {createdAccessCode ? (
                <p className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                  Chain access code:{" "}
                  <strong>{createdAccessCode}</strong>
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full rounded-xl px-6 py-4 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_PRIMARY_CLASS}`}
              >
                {isSubmitting
                  ? "Adding..."
                  : "Add Managed Property"}
              </button>
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
