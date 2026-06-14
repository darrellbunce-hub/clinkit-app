"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import { ROUTES } from "@/lib/auth/routes";
import {
  completeEstateAgentOnboarding,
  type EstateAgentOnboardingSummary,
} from "@/lib/estateAgent/completeOnboarding";
import {
  fetchProfileAccountFields,
} from "@/lib/currentUserContext";
import { supabase } from "@/lib/supabase";

const inputClassName =
  "mt-2 w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-3 disabled:bg-slate-100";

type OnboardingStep = 1 | 2 | "complete";

const stepLabels = [
  "Company",
  "Branch",
  "Confirm",
] as const;

export default function EstateAgentOnboardingPage() {
  const [step, setStep] =
    useState<OnboardingStep>(1);
  const [companyName, setCompanyName] =
    useState("");
  const [branchName, setBranchName] =
    useState("");
  const [townOrCity, setTownOrCity] =
    useState("");
  const [postcode, setPostcode] =
    useState("");
  const [isHeadOffice, setIsHeadOffice] =
    useState(true);
  const [businessEmail, setBusinessEmail] =
    useState("");
  const [emailDomain, setEmailDomain] =
    useState("");
  const [completionSummary, setCompletionSummary] =
    useState<EstateAgentOnboardingSummary | null>(
      null
    );
  const [errorMessage, setErrorMessage] =
    useState("");
  const [isLoading, setIsLoading] =
    useState(true);
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  useEffect(() => {
    async function loadOnboardingContext() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href =
          ROUTES.estateAgentLogin;

        return;
      }

      const profile =
        await fetchProfileAccountFields(
          supabase,
          user.id
        );

      if (
        profile?.onboarding_completed_at
      ) {
        window.location.href =
          ROUTES.agentHome;

        return;
      }

      setBusinessEmail(user.email ?? "");
      setEmailDomain(
        profile?.email_domain ?? ""
      );
      setIsLoading(false);
    }

    loadOnboardingContext();
  }, []);

  function handleCompanyStep(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");

    if (companyName.trim().length < 2) {
      setErrorMessage(
        "Enter your company name to continue."
      );

      return;
    }

    setStep(2);
  }

  async function handleBranchStep(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setErrorMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href =
        ROUTES.estateAgentLogin;

      return;
    }

    if (!emailDomain) {
      setErrorMessage(
        "Your business email domain is missing from your profile. Sign out and sign up again with a business email, or contact support."
      );

      return;
    }

    setIsSubmitting(true);

    try {
      const result =
        await completeEstateAgentOnboarding(
          supabase,
          {
            userId: user.id,
            companyName,
            branchName,
            townOrCity,
            postcode,
            isHeadOffice,
            emailDomain,
          }
        );

      if (!result.success) {
        setErrorMessage(result.error);

        return;
      }

      setCompletionSummary(result.summary);
      setStep("complete");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not complete onboarding. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleContinueToAgentHome() {
    window.location.href = ROUTES.agentHome;
  }

  const activeStepIndex =
    step === "complete"
      ? 3
      : step;

  if (isLoading) {
    return (
      <EaMarketingShell>
        <section className="max-w-xl mx-auto px-6 py-16">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center text-slate-600">
            Loading onboarding...
          </div>
        </section>
      </EaMarketingShell>
    );
  }

  return (
    <EaMarketingShell>
      <section className="max-w-xl mx-auto px-6 py-16">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
          <div className="flex items-center gap-2">
            {stepLabels.map((label, index) => {
              const stepNumber = index + 1;
              const isActive =
                stepNumber === activeStepIndex;
              const isDone =
                stepNumber < activeStepIndex;

              return (
                <div
                  key={label}
                  className="flex flex-1 items-center gap-2"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      isDone
                        ? "bg-green-100 text-green-800"
                        : isActive
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {isDone ? "✓" : stepNumber}
                  </div>

                  <span
                    className={`hidden text-sm font-medium sm:inline ${
                      isActive
                        ? "text-slate-900"
                        : "text-slate-500"
                    }`}
                  >
                    {label}
                  </span>

                  {index <
                    stepLabels.length - 1 && (
                    <div
                      className={`mx-1 h-px flex-1 ${
                        isDone
                          ? "bg-green-300"
                          : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {step === "complete" &&
          completionSummary ? (
            <>
              <h1 className="mt-8 text-4xl font-bold text-slate-900">
                Agency setup complete
              </h1>

              <p className="mt-2 text-slate-600">
                Your company and first branch are
                registered. Homeowners will be able
                to find and assign this branch.
              </p>

              <dl className="mt-8 space-y-4 rounded-2xl border border-green-200 bg-green-50 px-5 py-5">
                <div>
                  <dt className="text-sm font-medium text-slate-600">
                    Company
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">
                    {
                      completionSummary.companyName
                    }
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-600">
                    Branch
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">
                    {
                      completionSummary.branchName
                    }
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-600">
                    Town / city
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">
                    {
                      completionSummary.townOrCity
                    }
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-600">
                    Postcode
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-900">
                    {completionSummary.postcode}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={
                  handleContinueToAgentHome
                }
                className="mt-8 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold hover:bg-slate-800"
              >
                Continue to agent dashboard
              </button>
            </>
          ) : (
            <>
              <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Step {step} of 2
              </p>

              <h1 className="mt-4 text-4xl font-bold text-slate-900">
                {step === 1
                  ? "Company information"
                  : "First branch details"}
              </h1>

              <p className="mt-2 text-slate-600">
                {step === 1
                  ? "Enter your agency company name. Signup is not complete until you also register your first branch in the next step."
                  : "Register the branch homeowners will assign to their properties. All fields are required."}
              </p>

              {step === 1 ? (
                <form
                  onSubmit={handleCompanyStep}
                  className="mt-8 space-y-6"
                  noValidate
                >
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
                    <p className="font-semibold">
                      Two steps required
                    </p>
                    <p className="mt-1">
                      After this step you must enter
                      your branch name, town or city,
                      and postcode. You cannot access
                      the agent dashboard until both
                      steps are finished.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="company-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Company name
                    </label>

                    <input
                      id="company-name"
                      name="companyName"
                      type="text"
                      value={companyName}
                      onChange={(event) =>
                        setCompanyName(
                          event.target.value
                        )
                      }
                      disabled={isSubmitting}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="business-email"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Business email
                    </label>

                    <input
                      id="business-email"
                      type="email"
                      value={businessEmail}
                      readOnly
                      className={`${inputClassName} bg-slate-50`}
                    />
                  </div>

                  {errorMessage && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                    >
                      {errorMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold"
                  >
                    Continue to branch details
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleBranchStep}
                  className="mt-8 space-y-6"
                  noValidate
                >
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">
                      Company
                    </p>
                    <p className="mt-1">
                      {companyName}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="branch-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Branch name
                    </label>

                    <input
                      id="branch-name"
                      name="branchName"
                      type="text"
                      value={branchName}
                      onChange={(event) =>
                        setBranchName(
                          event.target.value
                        )
                      }
                      disabled={isSubmitting}
                      className={inputClassName}
                      placeholder="e.g. High Street"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="town-or-city"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Town / city
                    </label>

                    <input
                      id="town-or-city"
                      name="townOrCity"
                      type="text"
                      value={townOrCity}
                      onChange={(event) =>
                        setTownOrCity(
                          event.target.value
                        )
                      }
                      disabled={isSubmitting}
                      className={inputClassName}
                      placeholder="e.g. Winchester"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="branch-postcode"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Postcode
                    </label>

                    <input
                      id="branch-postcode"
                      name="postcode"
                      type="text"
                      value={postcode}
                      onChange={(event) =>
                        setPostcode(
                          event.target.value
                        )
                      }
                      disabled={isSubmitting}
                      className={inputClassName}
                      placeholder="e.g. SO23 9GH"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={isHeadOffice}
                      onChange={(event) =>
                        setIsHeadOffice(
                          event.target.checked
                        )
                      }
                      disabled={isSubmitting}
                      className="mt-1"
                    />

                    <span className="text-sm text-slate-700">
                      This branch is the head office
                    </span>
                  </label>

                  {errorMessage && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                    >
                      {errorMessage}
                    </p>
                  )}

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage("");
                        setStep(1);
                      }}
                      disabled={isSubmitting}
                      className="w-full border border-slate-300 text-slate-900 rounded-2xl py-4 font-semibold disabled:bg-slate-100"
                    >
                      Back
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold disabled:bg-slate-400"
                    >
                      {isSubmitting
                        ? "Registering branch..."
                        : "Register branch and finish setup"}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </EaMarketingShell>
  );
}
