import { buildAbsoluteAssetUrl } from "@/lib/communications/config";
import type {
  ClaimSuccessfulEmailParams,
  EstateAgentInvitationEmailParams,
  HomeownerInvitationEmailParams,
  PasswordResetEmailParams,
  WelcomeEmailParams,
} from "@/lib/communications/types";

const SAMPLE_INVITATION_LINK =
  "https://app.keynetic.co.uk/claim?token=sample-invitation-token";
const SAMPLE_RESET_LINK =
  "https://app.keynetic.co.uk/auth/confirm?token=sample-reset-token";
const SAMPLE_DASHBOARD_LINK = "https://app.keynetic.co.uk/dashboard";

export const EMAIL_SAMPLE_DATA = {
  propertyAddress: "42 Maple Grove, Bristol BS8 4LN",
  estateAgentName: "Sarah Mitchell",
  homeownerName: "James Patterson",
  recipientEmail: "james.patterson@example.com",
  invitationLink: SAMPLE_INVITATION_LINK,
  resetLink: SAMPLE_RESET_LINK,
  dashboardLink: SAMPLE_DASHBOARD_LINK,
  completionDate: "Friday 18 July 2026",
  branchName: "Harbourside Branch",
  companyName: "Northgate Estate Agents",
  expiresAt: "2026-07-12T18:00:00.000Z",
} as const;

export function getSampleHomeownerInvitationParams(): HomeownerInvitationEmailParams {
  return {
    to: EMAIL_SAMPLE_DATA.recipientEmail,
    homeownerName: EMAIL_SAMPLE_DATA.homeownerName,
    propertyAddress: EMAIL_SAMPLE_DATA.propertyAddress,
    branchName: EMAIL_SAMPLE_DATA.branchName,
    companyName: EMAIL_SAMPLE_DATA.companyName,
    invitationLink: EMAIL_SAMPLE_DATA.invitationLink,
    expiresAt: EMAIL_SAMPLE_DATA.expiresAt,
  };
}

export function getSampleEstateAgentInvitationParams(): EstateAgentInvitationEmailParams {
  return {
    to: "sarah.mitchell@northgate-estates.example",
    agentName: EMAIL_SAMPLE_DATA.estateAgentName,
    branchName: EMAIL_SAMPLE_DATA.branchName,
    companyName: EMAIL_SAMPLE_DATA.companyName,
    invitationLink: EMAIL_SAMPLE_DATA.invitationLink,
  };
}

export function getSamplePasswordResetParams(): PasswordResetEmailParams {
  return {
    to: EMAIL_SAMPLE_DATA.recipientEmail,
    recipientName: EMAIL_SAMPLE_DATA.homeownerName,
    resetLink: EMAIL_SAMPLE_DATA.resetLink,
  };
}

export function getSampleWelcomeEmailParams(): WelcomeEmailParams {
  return {
    to: EMAIL_SAMPLE_DATA.recipientEmail,
    recipientName: EMAIL_SAMPLE_DATA.homeownerName,
    dashboardLink: EMAIL_SAMPLE_DATA.dashboardLink,
  };
}

export function getSampleClaimSuccessfulParams(): ClaimSuccessfulEmailParams {
  return {
    to: EMAIL_SAMPLE_DATA.recipientEmail,
    homeownerName: EMAIL_SAMPLE_DATA.homeownerName,
    propertyAddress: EMAIL_SAMPLE_DATA.propertyAddress,
    branchName: EMAIL_SAMPLE_DATA.branchName,
    companyName: EMAIL_SAMPLE_DATA.companyName,
    dashboardLink: EMAIL_SAMPLE_DATA.dashboardLink,
  };
}

export function getSampleLogoUrls() {
  return {
    iconTeal: buildAbsoluteAssetUrl("/logos/keynetic-icon-teal.png"),
    wordmarkTeal: buildAbsoluteAssetUrl(
      "/logos/keynetic-wordmark-teal-v2.png"
    ),
    iconWhite: buildAbsoluteAssetUrl("/logos/keynetic-icon-white.png"),
    wordmarkWhite: buildAbsoluteAssetUrl(
      "/logos/keynetic-wordmark-white-v2.png"
    ),
  };
}
