import { flushIfServerless } from "@sentry/core";
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): Promise<void> {
  Sentry.captureRequestError(...args);

  // Sentry's captureRequestError schedules flush via vercelWaitUntil, which
  // only runs on Edge. Await serverless flush on Node route failures.
  await flushIfServerless({ timeout: 2000 });
}
