"use client";

import { useState, type FormEvent } from "react";

import AuthErrorAlert from "@/components/auth/AuthErrorAlert";
import AuthPasswordFieldWithRequirements from "@/components/auth/AuthPasswordFieldWithRequirements";
import AuthSuccessAlert from "@/components/auth/AuthSuccessAlert";
import AuthTextField from "@/components/auth/AuthTextField";
import {
  AUTH_FORM_CLASS,
  AUTH_PRIMARY_BUTTON_CLASS,
} from "@/components/auth/authStyles";
import { accountSectionClassName } from "@/components/account/accountStyles";
import {
  mapPasswordUpdateError,
  validateNewPassword,
} from "@/lib/auth/passwordPolicy";
import { supabase } from "@/lib/supabase";

type SecuritySectionProps = {
  email: string;
};

export default function SecuritySection({
  email,
}: SecuritySectionProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    const validation = validateNewPassword(
      newPassword,
      confirmPassword,
      currentPassword
    );

    if (!validation.valid) {
      setErrorMessage(validation.message);

      return;
    }

    if (!currentPassword) {
      setErrorMessage(
        "Enter your current password to continue."
      );

      return;
    }

    setIsSubmitting(true);

    try {
      const verifyResult = await supabase.auth.signInWithPassword(
        {
          email,
          password: currentPassword,
        }
      );

      if (verifyResult.error) {
        setErrorMessage("Current password is incorrect.");

        return;
      }

      const updateResult = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateResult.error) {
        setErrorMessage(
          mapPasswordUpdateError(updateResult.error.message)
        );

        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccessMessage(
        "Your password has been updated successfully."
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not update your password. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section id="security" className={accountSectionClassName}>
      <div className="max-w-xl">
        <h2 className="text-xl font-bold text-text-charcoal">
          Security
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Change your password while signed in. You will need your
          current password to confirm the change.
        </p>

        <form
          onSubmit={handleSubmit}
          className={`${AUTH_FORM_CLASS} mt-6`}
          noValidate
        >
          <AuthTextField
            id="current-password"
            name="currentPassword"
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            disabled={isSubmitting}
          />

          <AuthPasswordFieldWithRequirements
            id="new-password"
            name="newPassword"
            label="New password"
            password={newPassword}
            onPasswordChange={setNewPassword}
            autoComplete="new-password"
            disabled={isSubmitting}
          />

          <AuthTextField
            id="confirm-password"
            name="confirmPassword"
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            disabled={isSubmitting}
          />

          {errorMessage ? (
            <AuthErrorAlert message={errorMessage} />
          ) : null}

          {successMessage ? (
            <AuthSuccessAlert message={successMessage} />
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className={AUTH_PRIMARY_BUTTON_CLASS}
          >
            {isSubmitting
              ? "Updating password..."
              : "Update password"}
          </button>
        </form>
      </div>
    </section>
  );
}
