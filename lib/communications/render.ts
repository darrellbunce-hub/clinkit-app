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
import PropertyClaimedEmail, {
  getClaimSuccessfulSubject,
} from "@/emails/templates/PropertyClaimed";
import WelcomeEmail, {
  getWelcomeEmailSubject,
} from "@/emails/templates/WelcomeEmail";
import {
  getSampleClaimSuccessfulParams,
  getSampleEstateAgentInvitationParams,
  getSampleHomeownerInvitationParams,
  getSamplePasswordResetParams,
  getSampleWelcomeEmailParams,
} from "@/lib/communications/sampleData";

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
    getClaimSuccessfulSubject(props)
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
    default:
      throw new Error(`Unknown email template: ${templateId satisfies never}`);
  }
}
