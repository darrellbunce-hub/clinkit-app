"use client";

import {
  formatAccountTypeLabel,
  resolveDisplayName,
} from "@/lib/auth/accountDisplay";
import type { AccountType } from "@/lib/accountType";
import { accountSectionClassName } from "@/components/account/accountStyles";

type ProfileSectionProps = {
  accountType: AccountType;
  contactName: string | null;
  email: string | null;
};

function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-base font-medium text-slate-900 break-words">
        {value}
      </dd>
    </div>
  );
}

export default function ProfileSection({
  accountType,
  contactName,
  email,
}: ProfileSectionProps) {
  const displayName = resolveDisplayName(
    { contact_name: contactName },
    email
  );

  return (
    <section
      id="profile"
      className={accountSectionClassName}
    >
      <div className="max-w-xl">
        <h2 className="text-xl font-bold text-slate-900">
          Profile
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Your account identity. Profile editing will be
          available in a future release.
        </p>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <ReadOnlyField
            label="Name"
            value={displayName}
          />

          <ReadOnlyField
            label="Email"
            value={email ?? "Not available"}
          />

          <ReadOnlyField
            label="Account Type"
            value={formatAccountTypeLabel(
              accountType
            )}
          />
        </dl>
      </div>
    </section>
  );
}
