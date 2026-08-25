import { NextResponse } from "next/server";

import { requireEaBranchBillingMember } from "@/lib/billing/eaBillingAuth";
import { createEaBillingPortalSession } from "@/lib/billing/eaPortal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = {
  branchId?: string;
  customerId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const branchId = body.branchId?.trim();
    if (!branchId) {
      return NextResponse.json(
        { ok: false, error: "branch_required" },
        { status: 400 }
      );
    }

    if (body.customerId) {
      return NextResponse.json(
        { ok: false, error: "client_customer_id_forbidden" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    const authz = await requireEaBranchBillingMember(supabase, user, branchId);
    if (!authz.ok) {
      return NextResponse.json(
        { ok: false, error: authz.error },
        { status: authz.status }
      );
    }

    // Portal mutations for billing: require Owner
    if (!authz.context.isOwner) {
      return NextResponse.json(
        { ok: false, error: "not_branch_admin" },
        { status: 403 }
      );
    }

    const result = await createEaBillingPortalSession(authz.context);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ ok: true, url: result.url });
  } catch {
    return NextResponse.json(
      { ok: false, error: "portal_unavailable" },
      { status: 503 }
    );
  }
}
