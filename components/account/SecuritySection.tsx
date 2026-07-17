"use client";

import {
  useState,
  type FormEvent,
} from "react";

import PasswordRequirementsChecklist from "@/components/auth/PasswordRequirementsChecklist";
import {
  accountAlertErrorClassName,
  accountAlertSuccessClassName,
  accountButtonPrimaryClassName,
  accountInputClassName,
  accountSectionClassName,
} from "@/components/account/accountStyles";
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
  const [currentPassword, setCurrentPassword] =
    useState("");
  const [newPassword, setNewPassword] =
    useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
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
      const verifyResult =
        await supabase.auth.signInWithPassword(
          {
            email,
            password: currentPassword,
          }
        );

      if (verifyResult.error) {
        setErrorMessage(
          "Current password is incorrect."
        );

        return;
      }

      const updateResult =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (updateResult.error) {
        setErrorMessage(
          mapPasswordUpdateError(
            updateResult.error.message
          )
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
    <section
      id="security"
      className={accountSectionClassName}
    >
      <div className="max-w-xl">
        <h2 className="text-xl font-bold text-slate-900">
          Security
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Change your password while signed in. You will
          need your current password to confirm the change.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-5"
          noValidate
        >
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-slate-700"
            >
              Current password
            </label>

            <input
              id="current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) =>
                setCurrentPassword(
                  event.target.value
                )
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />
          </div>

          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-slate-700"
            >
              New password
            </label>

            <input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) =>
                setNewPassword(event.target.value)
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />

            <PasswordRequirementsChecklist
              password={newPassword}
              className="mt-3"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-slate-700"
            >
              Confirm new password
            </label>

            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(
                  event.target.value
                )
              }
              disabled={isSubmitting}
              className={accountInputClassName}
            />
          </div>

          {errorMessage && (
            <p
              role="alert"
              className={accountAlertErrorClassName}
            >
              {errorMessage}
            </p>
          )}

          {successMessage && (
            <p
              role="status"
              className={accountAlertSuccessClassName}
            >
              {successMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={accountButtonPrimaryClassName}
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
