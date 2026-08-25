import { NextResponse } from "next/server";

import { runBillingHealthCheck } from "@/lib/billing/eaBillingHealthCheck";
import { processEaBillingGraceReminderEmails } from "@/lib/billing/eaBillingCustomerEmails";
import { isAuthorizedLifecycleCronRequest } from "@/lib/lifecycle/cronAuth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stripe billing operational health check (Day 1).
 *
 * Secured via Authorization: Bearer ${CRON_SECRET}.
 * Response contains counts + incident keys only — no Stripe IDs or customer PII.
 *
 * Configure in vercel.json (e.g. every 30 minutes) and set:
 *   CRON_SECRET
 *   BILLING_OPS_ALERT_EMAIL (ops mailbox, e.g. admin@keynetic.co.uk)
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!isAuthorizedLifecycleCronRequest(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createServiceRoleSupabaseClient();
    const result = await runBillingHealthCheck({ admin });
    const graceReminders = await processEaBillingGraceReminderEmails(admin);

    return NextResponse.json({
      ...result.publicReport,
      alertsAttempted: result.alertsAttempted,
      alertsSent: result.alertsSent,
      alertsDeduped: result.alertsDeduped,
      alertsFailed: result.alertsFailed,
      alertsSkipped: result.alertsSkipped,
      recoveriesSent: result.recoveriesSent,
      graceRemindersScanned: graceReminders.scanned,
      graceMidSent: graceReminders.midSent,
      graceFinalSent: graceReminders.finalSent,
      graceRemindersSkipped: graceReminders.skipped,
    });
  } catch (error) {
    console.error("[billing-health] check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "billing_health_check_failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
