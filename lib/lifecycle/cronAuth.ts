import { timingSafeEqual } from "crypto";

/**
 * Validates Vercel Cron / manual invocations of lifecycle workers.
 */
export function isAuthorizedLifecycleCronRequest(
  authorizationHeader: string | null
): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return false;
  }

  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const provided = authorizationHeader.slice("Bearer ".length).trim();

  try {
    const expected = Buffer.from(cronSecret, "utf8");
    const actual = Buffer.from(provided, "utf8");

    if (expected.length !== actual.length) {
      return false;
    }

    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
