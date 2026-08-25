export const INVITATION_REJECTION_REASONS = [
  {
    value: "not_my_property",
    label: "This isn't my property",
  },
  {
    value: "wrong_email",
    label: "Wrong email address",
  },
  {
    value: "no_longer_moving",
    label: "I'm no longer moving",
  },
  {
    value: "other",
    label: "Other",
  },
] as const;

export type InvitationRejectionReason =
  (typeof INVITATION_REJECTION_REASONS)[number]["value"];

export function formatInvitationRejectionReason(
  reason: string | null | undefined
): string | null {
  if (!reason) {
    return null;
  }

  const match = INVITATION_REJECTION_REASONS.find(
    (entry) => entry.value === reason
  );

  return match?.label ?? null;
}
