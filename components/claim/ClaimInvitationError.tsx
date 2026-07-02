import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";

export default function ClaimInvitationError({
  error,
}: {
  error: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${CARD_PADDING_CLASS}`}
    >
      <h1 className={PAGE_TITLE_CLASS}>
        {getTitle(error)}
      </h1>

      <p className="mt-3 text-slate-600">
        {getMessage(error)}
      </p>
    </div>
  );
}

function getTitle(error: string): string {
  switch (error) {
    case "expired":
      return "Invitation expired";
    case "already_used":
    case "already_claimed":
      return "Invitation already used";
    case "email_mismatch":
      return "Invitation not available";
    default:
      return "Invitation invalid";
  }
}

function getMessage(error: string): string {
  switch (error) {
    case "expired":
      return "Please contact your estate agent for a new invitation.";
    case "already_used":
      return "This invitation has already been used.";
    case "already_claimed":
      return "This property has already been claimed.";
    case "email_mismatch":
      return "Sign in with the email address your estate agent used for this invitation.";
    case "not_authenticated":
      return "Sign in to continue with your property claim.";
    case "homeowner_only":
      return "Only homeowner accounts can claim managed properties.";
    case "email_required":
      return "Your account must have an email address to claim this property.";
    default:
      return "This invitation link is not valid.";
  }
}
