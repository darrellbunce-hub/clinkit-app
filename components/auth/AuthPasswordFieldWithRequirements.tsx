"use client";

import type { ReactNode } from "react";

import {
  AUTH_INPUT_CLASS,
  AUTH_LABEL_CLASS,
} from "@/components/auth/authStyles";
import PasswordRequirementsChecklist from "@/components/auth/PasswordRequirementsChecklist";

export { AUTH_INPUT_CLASS as AUTH_PASSWORD_INPUT_CLASS } from "@/components/auth/authStyles";

type AuthPasswordFieldWithRequirementsProps = {
  id: string;
  name?: string;
  label: ReactNode;
  password: string;
  onPasswordChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  showRequirements?: boolean;
  className?: string;
  inputClassName?: string;
  labelAccessory?: ReactNode;
};

/**
 * Shared password field + live requirement checklist for all auth surfaces.
 * Validation rules come from lib/auth/passwordPolicy.ts via PasswordRequirementsChecklist.
 */
export default function AuthPasswordFieldWithRequirements({
  id,
  name,
  label,
  password,
  onPasswordChange,
  autoComplete = "new-password",
  disabled = false,
  showRequirements = true,
  className = "",
  inputClassName = AUTH_INPUT_CLASS,
  labelAccessory,
}: AuthPasswordFieldWithRequirementsProps) {
  return (
    <div className={className}>
      {labelAccessory ? (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={id} className={AUTH_LABEL_CLASS}>
            {label}
          </label>

          {labelAccessory}
        </div>
      ) : (
        <label htmlFor={id} className={AUTH_LABEL_CLASS}>
          {label}
        </label>
      )}

      <input
        id={id}
        name={name}
        type="password"
        autoComplete={autoComplete}
        disabled={disabled}
        value={password}
        onChange={(event) =>
          onPasswordChange(event.target.value)
        }
        className={inputClassName}
      />

      {showRequirements ? (
        <PasswordRequirementsChecklist
          password={password}
          className="mt-3"
        />
      ) : null}
    </div>
  );
}
