import * as Sentry from "@sentry/nextjs";

import { initializeSentry } from "@/lib/observability/sentryShared";

initializeSentry("client");

export const onRouterTransitionStart =
  Sentry.captureRouterTransitionStart;
