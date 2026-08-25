"use client";

import {
  getPasswordRequirementStates,
  PASSWORD_POLICY,
} from "@/lib/auth/passwordPolicy";

type PasswordRequirementsChecklistProps = {
  password: string;
  className?: string;
};

export default function PasswordRequirementsChecklist({
  password,
  className = "",
}: PasswordRequirementsChecklistProps) {
  const states = getPasswordRequirementStates(password);
  const showStatus = password.length > 0;

  return (
    <div className={className}>
      <p className="text-sm font-medium text-slate-700">
        Password must contain:
      </p>

      <ul
        className="mt-2 space-y-1.5"
        aria-live="polite"
        aria-relevant="text"
      >
        {states.map((requirement) => {
          const met = showStatus && requirement.met;

          return (
            <li
              key={requirement.id}
              className={`flex items-start gap-2 text-sm ${
                met
                  ? "text-green-700"
                  : showStatus
                    ? "text-red-700"
                    : "text-slate-600"
              }`}
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0">
                {met ? "✓" : showStatus ? "✗" : "•"}
              </span>

              <span>{requirement.label}</span>
            </li>
          );
        })}
      </ul>

      <p className="sr-only">
        Minimum length {PASSWORD_POLICY.minLength} characters with uppercase,
        lowercase, number, and symbol required.
      </p>
    </div>
  );
}
