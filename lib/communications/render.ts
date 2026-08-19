import { render } from "@react-email/render";
import type { ReactElement } from "react";

import type { EmailTemplateId } from "@/lib/communications/types";
import EstateAgentInvitationEmail, {
  getEstateAgentInvitationSubject,
} from "@/emails/templates/EstateAgentInvitation";
import HomeownerInvitationEmail, {
  getHomeownerInvitationSubject,
} from "@/emails/templates/HomeownerInvitation";
import PasswordResetEmail, {
  getPasswordResetSubject,
} from "@/emails/templates/PasswordReset";
import DormancyWarningEmail, {
  getDormancyWarningSubject,
} from "@/emails/templates/DormancyWarning";
import PropertyClaimedEmail, {
  getClaimSuccessfulSubject,
} from "@/emails/templates/PropertyClaimed";
import WelcomeEmail, {
  getWelcomeEmailSubject,
} from "@/emails/templates/WelcomeEmail";
import EaSubscriptionConfirmationEmail, {
  getEaSubscriptionConfirmationSubject,
} from "@/emails/templates/EaSubscriptionConfirmation";
import EaPaymentFailedEmail, {
  getEaPaymentFailedSubject,
} from "@/emails/templates/EaPaymentFailed";
import EaGraceReminderEmail, {
  getEaGraceReminderSubject,
} from "@/emails/templates/EaGraceReminder";
import EaGraceFinalWarningEmail, {
  getEaGraceFinalWarningSubject,
} from "@/emails/templates/EaGraceFinalWarning";
import EaSubscriptionCancelledEmail, {
  getEaSubscriptionCancelledSubject,
} from "@/emails/templates/EaSubscriptionCancelled";
import {
  getSampleClaimSuccessfulParams,
  getSampleDormancyWarningParams,
  getSampleEaGraceFinalWarningParams,
  getSampleEaGraceReminderParams,
  getSampleEaPaymentFailedParams,
  getSampleEaSubscriptionCancelledParams,
  getSampleEaSubscriptionConfirmationParams,
  getSampleEstateAgentInvitationParams,
  getSampleHomeownerInvitationParams,
  getSamplePasswordResetParams,
  getSampleWelcomeEmailParams,
} from "@/lib/communications/sampleData";
import type {
  DormancyWarningEmailParams,
  EaGraceFinalWarningEmailParams,
  EaGraceReminderEmailParams,
  EaPaymentFailedEmailParams,
  EaSubscriptionCancelledEmailParams,
  EaSubscriptionConfirmationEmailParams,
} from "@/lib/communications/types";

export type RenderedEmail = {
  html: string;
  text: string;
  subject: string;
};

async function renderEmailTemplate(
  element: ReactElement,
  subject: string
): Promise<RenderedEmail> {
  const html = await render(element);
  const text = await render(element, { plainText: true });

  return {
    html,
    text,
    subject,
  };
}

export async function renderHomeownerInvitation(
  props = getSampleHomeownerInvitationParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    HomeownerInvitationEmail(props),
    getHomeownerInvitationSubject(props)
  );
}

export async function renderEstateAgentInvitation(
  props = getSampleEstateAgentInvitationParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EstateAgentInvitationEmail(props),
    getEstateAgentInvitationSubject(props)
  );
}

export async function renderPasswordReset(
  props = getSamplePasswordResetParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    PasswordResetEmail(props),
    getPasswordResetSubject()
  );
}

export async function renderWelcomeEmail(
  props = getSampleWelcomeEmailParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    WelcomeEmail(props),
    getWelcomeEmailSubject()
  );
}

export async function renderClaimSuccessful(
  props = getSampleClaimSuccessfulParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    PropertyClaimedEmail(props),
    getClaimSuccessfulSubject()
  );
}

export async function renderDormancyWarning(
  props: DormancyWarningEmailParams = getSampleDormancyWarningParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    DormancyWarningEmail(props),
    getDormancyWarningSubject()
  );
}

export async function renderEaSubscriptionConfirmation(
  props: EaSubscriptionConfirmationEmailParams = getSampleEaSubscriptionConfirmationParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EaSubscriptionConfirmationEmail(props),
    getEaSubscriptionConfirmationSubject(props)
  );
}

export async function renderEaPaymentFailed(
  props: EaPaymentFailedEmailParams = getSampleEaPaymentFailedParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EaPaymentFailedEmail(props),
    getEaPaymentFailedSubject()
  );
}

export async function renderEaGraceReminder(
  props: EaGraceReminderEmailParams = getSampleEaGraceReminderParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EaGraceReminderEmail(props),
    getEaGraceReminderSubject()
  );
}

export async function renderEaGraceFinalWarning(
  props: EaGraceFinalWarningEmailParams = getSampleEaGraceFinalWarningParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EaGraceFinalWarningEmail(props),
    getEaGraceFinalWarningSubject()
  );
}

export async function renderEaSubscriptionCancelled(
  props: EaSubscriptionCancelledEmailParams = getSampleEaSubscriptionCancelledParams()
): Promise<RenderedEmail> {
  return renderEmailTemplate(
    EaSubscriptionCancelledEmail(props),
    getEaSubscriptionCancelledSubject()
  );
}

export async function renderEmailTemplateById(
  templateId: EmailTemplateId
): Promise<RenderedEmail> {
  switch (templateId) {
    case "homeowner-invitation":
      return renderHomeownerInvitation();
    case "estate-agent-invitation":
      return renderEstateAgentInvitation();
    case "password-reset":
      return renderPasswordReset();
    case "welcome":
      return renderWelcomeEmail();
    case "property-claimed":
      return renderClaimSuccessful();
    case "lifecycle-dormancy-warning":
      return renderDormancyWarning();
    case "ea-subscription-confirmation":
      return renderEaSubscriptionConfirmation();
    case "ea-payment-failed":
      return renderEaPaymentFailed();
    case "ea-grace-reminder":
      return renderEaGraceReminder();
    case "ea-grace-final-warning":
      return renderEaGraceFinalWarning();
    case "ea-subscription-cancelled":
      return renderEaSubscriptionCancelled();
    default:
      throw new Error(`Unknown email template: ${templateId satisfies never}`);
  }
}
