import { NextResponse } from "next/server";

import { sendHomeownerInvitation } from "@/lib/communications/email";
import {
  loadActiveInvitationExpiresAt,
  loadHomeownerInvitationEmailContext,
} from "@/lib/communications/invitationContext";
import { recordPropertyClaimInvitationSent } from "@/lib/propertyClaim/propertyInvitations";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type HomeownerInvitationRequestBody = {
  propertyId?: number;
  claimUrl?: string;
  expiresAt?: string;
  resendExisting?: boolean;
};

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as HomeownerInvitationRequestBody;

    const propertyId = Number(body.propertyId);
    const claimUrl = body.claimUrl?.trim();
    const resendExisting = body.resendExisting === true;
    let expiresAt = body.expiresAt?.trim();

    if (!Number.isFinite(propertyId) || propertyId <= 0 || !claimUrl) {
      return NextResponse.json(
        {
          ok: false,
          sent: false,
          error: "invalid_request",
        },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          sent: false,
          error: "unauthorized",
        },
        { status: 401 }
      );
    }

    if (resendExisting) {
      const activeExpiresAt = await loadActiveInvitationExpiresAt(
        supabase,
        propertyId
      );

      if (!activeExpiresAt) {
        return NextResponse.json({
          ok: false,
          sent: false,
          error: "invitation_not_active",
        });
      }

      expiresAt = activeExpiresAt;
    }

    if (!expiresAt) {
      return NextResponse.json(
        {
          ok: false,
          sent: false,
          error: "invalid_request",
        },
        { status: 400 }
      );
    }

    const emailContext = await loadHomeownerInvitationEmailContext(
      supabase,
      propertyId,
      claimUrl,
      expiresAt
    );

    if (!emailContext) {
      return NextResponse.json({
        ok: false,
        sent: false,
        error: "invitation_context_unavailable",
      });
    }

    const result = await sendHomeownerInvitation(emailContext, {
      sentBy: user.id,
      propertyId,
    });

    if (result.ok && result.sent) {
      const recordResult = await recordPropertyClaimInvitationSent(
        supabase,
        propertyId
      );

      if (!recordResult.ok) {
        console.error(
          "[communications] Failed to record invitation sent:",
          recordResult.error
        );
      }
    }

    if (!result.ok) {
      console.error(
        "[communications] Homeowner invitation email failed:",
        result.error
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[communications] Homeowner invitation route exception:",
      error
    );

    return NextResponse.json({
      ok: false,
      sent: false,
      error: "unexpected_error",
    });
  }
}
