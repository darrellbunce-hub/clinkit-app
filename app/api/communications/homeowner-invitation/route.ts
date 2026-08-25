import { NextResponse } from "next/server";

import { sendHomeownerInvitation } from "@/lib/communications/email";
import { buildServerClaimInvitationUrl } from "@/lib/communications/invitationLinks";
import { loadHomeownerInvitationEmailContext } from "@/lib/communications/invitationContext";
import {
  buildIdempotentSendSuccess,
  buildRateLimitedSendFailure,
  evaluateInvitationSendGuards,
  validateHomeownerInvitationForEmailSend,
} from "@/lib/communications/invitationSendSecurity";
import { recordPropertyClaimInvitationSent } from "@/lib/propertyClaim/propertyInvitations";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type HomeownerInvitationRequestBody = {
  propertyId?: number;
  invitationToken?: string;
};

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as HomeownerInvitationRequestBody;

    const propertyId = Number(body.propertyId);
    const invitationToken = body.invitationToken?.trim();

    if (
      !Number.isFinite(propertyId) ||
      propertyId <= 0 ||
      !invitationToken
    ) {
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

    const validation = await validateHomeownerInvitationForEmailSend(
      supabase,
      propertyId,
      invitationToken
    );

    if (!validation.ok) {
      return NextResponse.json({
        ok: false,
        sent: false,
        error: validation.error,
      });
    }

    const guard = await evaluateInvitationSendGuards({
      template: "homeowner-invitation",
      propertyId,
    });

    if (guard.action === "rate_limited") {
      return NextResponse.json(buildRateLimitedSendFailure());
    }

    if (guard.action === "idempotent_success") {
      return NextResponse.json(buildIdempotentSendSuccess());
    }

    const invitationLink = buildServerClaimInvitationUrl(invitationToken);

    const emailContext = await loadHomeownerInvitationEmailContext(
      supabase,
      propertyId,
      invitationLink,
      validation.expiresAt
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
      invitationId: validation.invitationId,
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
