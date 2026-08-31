"use client";

import {
  Suspense,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import AuthEmailField from "@/components/auth/AuthEmailField";
import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import AuthTextField from "@/components/auth/AuthTextField";
import {
  AUTH_CARD_CLASS,
  AUTH_EA_SECTION_CLASS,
  AUTH_FORM_CLASS,
  AUTH_FOOTER_LINK_CLASS,
  AUTH_FOOTER_TEXT_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
  AUTH_SUBTITLE_CLASS,
  AUTH_TITLE_CLASS,
} from "@/components/auth/authStyles";
import EaMarketingShell from "@/components/estate-agents/EaMarketingShell";
import CollectionPointNotice from "@/components/legal/CollectionPointNotice";
import LegalAcceptanceFields from "@/components/legal/LegalAcceptanceFields";
import { mapAuthSignUpError } from "@/lib/auth/authErrors";
import { validateNewPassword } from "@/lib/auth/passwordPolicy";
import { ROUTES } from "@/lib/auth/routes";
import { validateBusinessEmail } from "@/lib/businessEmail";
import {
  formatEaBranchInvitationError,
  previewEaBranchInvitation,
} from "@/lib/estateAgent/branchTeam";
import { createEstateAgentProfile } from "@/lib/estateAgent/createEstateAgentProfile";
import { queuePendingEstateAgentProfile } from "@/lib/estateAgent/flushPendingEstateAgentProfile";
import { buildEstateAgentSignupAuthMetadata } from "@/lib/estateAgent/signupAuthMetadata";
import {
  LEGAL_DOCUMENT_VERSIONS,
  SIGNUP_LEGAL_ACCEPTANCE_ERROR,
} from "@/lib/legal/constants";
import {
  buildEstateAgentSignupLegalAcceptance,
  isSignupLegalAcceptanceComplete,
  persistSignupLegalAcceptanceAfterAuth,
} from "@/lib/legal/recordSignupLegalAcceptance";
import { supabase } from "@/lib/supabase";

function AuthLoadingCard({
  message,
}: {
  message: string;
}) {
  return (
    <EaMarketingShell>
      <section className={AUTH_EA_SECTION_CLASS}>
        <div
          className={`${AUTH_CARD_CLASS} text-center text-slate-600`}
        >
          {message}
        </div>
      </section>
    </EaMarketingShell>
  );
}

export default function EstateAgentSignupPage() {
  return (
    <Suspense fallback={<AuthLoadingCard message="Loading…" />}>
      <EstateAgentSignupContent />
    </Suspense>
  );
}

function EstateAgentSignupContent() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");

  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState("");
  const [inviteCompanyName, setInviteCompanyName] =
    useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [confirmPasswordValue, setConfirmPasswordValue] =
    useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] =
    useState(false);

  useEffect(() => {
    async function loadInvitePreview() {
      if (!inviteToken) {
        return;
      }

      const previewResult = await previewEaBranchInvitation(
        supabase,
        inviteToken
      );

      if (!previewResult.ok) {
        setErrorMessage(
          formatEaBranchInvitationError(previewResult.error)
        );
        return;
      }

      setPrefillEmail(previewResult.preview.inviteEmail);
      setInviteCompanyName(previewResult.preview.companyName);
    }

    void loadInvitePreview();
  }, [inviteToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);

    const trimmedContactName = String(
      formData.get("contactName") ?? ""
    ).trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(
      formData.get("confirmPassword") ?? ""
    );

    if (!trimmedContactName || !email || !password) {
      setErrorMessage(
        "Complete all required fields to create your account."
      );

      return;
    }

    if (trimmedContactName.length < 2) {
      setErrorMessage(
        "Enter your contact name to continue."
      );

      return;
    }

    const emailValidation = validateBusinessEmail(email);

    if (!emailValidation.valid) {
      setErrorMessage(emailValidation.message);

      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");

      return;
    }

    const passwordValidation = validateNewPassword(
      password,
      confirmPassword
    );

    if (!passwordValidation.valid) {
      setErrorMessage(passwordValidation.message);

      return;
    }

    if (
      !isSignupLegalAcceptanceComplete(
        termsAccepted,
        privacyAccepted
      )
    ) {
      setErrorMessage(SIGNUP_LEGAL_ACCEPTANCE_ERROR);

      return;
    }

    setIsSubmitting(true);

    const acceptedAt = new Date().toISOString();
    const legalAcceptance =
      buildEstateAgentSignupLegalAcceptance(
        LEGAL_DOCUMENT_VERSIONS.estateAgentTerms,
        LEGAL_DOCUMENT_VERSIONS.privacyPolicy,
        acceptedAt
      );

    try {
      const { data, error } = await supabase.auth.signUp({
        email: emailValidation.email,
        password,
        options: {
          data: buildEstateAgentSignupAuthMetadata(
            trimmedContactName
          ),
        },
      });

      if (error) {
        setErrorMessage(mapAuthSignUpError(error.message));

        return;
      }

      if (!data.user) {
        setErrorMessage(
          "Could not create your account. Try again."
        );

        return;
      }

      const legalRecord =
        await persistSignupLegalAcceptanceAfterAuth(
          supabase,
          legalAcceptance
        );

      if (!legalRecord.ok) {
        setErrorMessage(
          "Your account was created but we could not record legal acceptance. Try signing in again."
        );

        return;
      }

      if (!data.session) {
        // Email confirmation required — no authenticated JWT yet.
        // Queue EA profile fields; never upsert profiles as anon.
        queuePendingEstateAgentProfile({
          contactName: trimmedContactName,
          email: emailValidation.email,
        });

        window.location.href = inviteToken
          ? `${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`
          : "/verify-email";

        return;
      }

      const profileResult = await createEstateAgentProfile(
        supabase,
        {
          userId: data.user.id,
          contactName: trimmedContactName,
          email: emailValidation.email,
        }
      );

      if (profileResult.error) {
        setErrorMessage(profileResult.error);

        return;
      }

      window.location.href = inviteToken
        ? `${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`
        : ROUTES.estateAgentOnboarding;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not create your account. Check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <EaMarketingShell>
      <section className={AUTH_EA_SECTION_CLASS}>
        <div className={AUTH_CARD_CLASS}>
          <h1 className={AUTH_TITLE_CLASS}>Create account</h1>

          <p className={AUTH_SUBTITLE_CLASS}>
            {inviteCompanyName
              ? `Create your account to join ${inviteCompanyName}.`
              : "Create your agency account using your work email address."}
          </p>

          <form
            onSubmit={handleSubmit}
            className={AUTH_FORM_CLASS}
            noValidate
          >
            <AuthTextField
              id="ea-contact-name"
              name="contactName"
              label="Contact name"
              value={contactName}
              onChange={setContactName}
              autoComplete="name"
              disabled={isSubmitting}
            />

            <AuthEmailField
              id="ea-email"
              name="email"
              label="Work email"
              defaultValue={prefillEmail}
              readOnly={Boolean(prefillEmail)}
              disabled={isSubmitting}
            />

            <AuthPasswordFieldWithRequirements
              id="ea-password"
              name="password"
              label="Password"
              password={passwordValue}
              onPasswordChange={setPasswordValue}
              autoComplete="new-password"
              disabled={isSubmitting}
            />

            <AuthTextField
              id="ea-confirm-password"
              name="confirmPassword"
              label="Confirm password"
              type="password"
              value={confirmPasswordValue}
              onChange={setConfirmPasswordValue}
              autoComplete="new-password"
              disabled={isSubmitting}
            />

            {errorMessage ? (
              <AuthErrorAlert message={errorMessage} />
            ) : null}

            <LegalAcceptanceFields
              variant="estate-agent"
              termsAccepted={termsAccepted}
              privacyAccepted={privacyAccepted}
              onTermsAcceptedChange={setTermsAccepted}
              onPrivacyAcceptedChange={setPrivacyAccepted}
              disabled={isSubmitting}
            />

            <CollectionPointNotice
              context="estate-agent"
            />

            <button
              type="submit"
              disabled={isSubmitting}
              className={AUTH_PRIMARY_BUTTON_CLASS}
            >
              {isSubmitting
                ? "Creating account..."
                : "Create account"}
            </button>
          </form>

          <p className={AUTH_FOOTER_TEXT_CLASS}>
            Already registered?{" "}
            <Link
              href={
                inviteToken
                  ? `${ROUTES.estateAgentLogin}?next=${encodeURIComponent(`${ROUTES.estateAgentJoin}?token=${encodeURIComponent(inviteToken)}`)}`
                  : ROUTES.estateAgentLogin
              }
              className={AUTH_FOOTER_LINK_CLASS}
            >
              Log in
            </Link>
          </p>

          <p className="mt-3 text-sm text-slate-600">
            Homeowner?{" "}
            <Link
              href={ROUTES.homeownerLogin}
              className={AUTH_FOOTER_LINK_CLASS}
            >
              Log in here
            </Link>
          </p>
        </div>
      </section>
    </EaMarketingShell>
  );
}
