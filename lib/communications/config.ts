const DEFAULT_EMAIL_FROM = "Keynetic <notifications@keynetic.co.uk>";

export function getEmailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

export function getAppBaseUrl(): string {
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim();

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();

  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/$/, "")}`;
  }

  return "http://localhost:3000";
}

export function isEmailSendingEnabled(): boolean {
  if (process.env.EMAIL_SENDING_ENABLED === "false") {
    return false;
  }

  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function isDeveloperEmailToolsEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function buildAbsoluteAssetUrl(assetPath: string): string {
  const normalizedPath = assetPath.startsWith("/")
    ? assetPath
    : `/${assetPath}`;

  return `${getAppBaseUrl()}${normalizedPath}`;
}
