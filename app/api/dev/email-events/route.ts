import { NextResponse } from "next/server";

import { isDeveloperEmailToolsEnabled } from "@/lib/communications/config";
import { listRecentEmailEvents } from "@/lib/communications/emailEvents";
import type { EmailEventStatus } from "@/lib/communications/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/serviceRole";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function parseStatusFilter(
  value: string | null
): EmailEventStatus | null {
  if (
    value === "queued" ||
    value === "sent" ||
    value === "failed"
  ) {
    return value;
  }

  return null;
}

export async function GET(request: Request) {
  if (!isDeveloperEmailToolsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const status = parseStatusFilter(searchParams.get("status"));
  const limit = Number(searchParams.get("limit") ?? 50);

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleSupabaseClient();
  const events = await listRecentEmailEvents(serviceSupabase, {
    status,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return NextResponse.json({ events });
}
