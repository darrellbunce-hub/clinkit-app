import { NextResponse } from "next/server";

import { loadEaBranchInvitationEmailContext } from "@/lib/communications/branchInvitationContext";
import { sendEstateAgentInvitation } from "@/lib/communications/email";
import { buildServerEaBranchInvitationUrl } from "@/lib/communications/invitationLinks";
import {
  buildIdempotentSendSuccess,
  buildRateLimitedSendFailure,
  evaluateInvitationSendGuards,
  validateEaBranchInvitationForEmailSend,
} from "@/lib/communications/invitationSendSecurity";
import { recordEaBranchInvitationSent } from "@/lib/estateAgent/branchTeam";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type EstateAgentInvitationRequestBody = {
  invitationId?: string;
  invitationToken?: string;
};

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as EstateAgentInvitationRequestBody;

    const invitationId = body.invitationId?.trim();
    const invitationToken = body.invitationToken?.trim();

    if (!invitationId || !invitationToken) {
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

    const validation = await validateEaBranchInvitationForEmailSend(
      supabase,
      invitationId,
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
      template: "estate-agent-invitation",
      recipientEmail: validation.inviteEmail,
    });

    if (guard.action === "rate_limited") {
      return NextResponse.json(buildRateLimitedSendFailure());
    }

    if (guard.action === "idempotent_success") {
      return NextResponse.json(buildIdempotentSendSuccess());
    }

    const invitationLink =
      buildServerEaBranchInvitationUrl(invitationToken);

    const emailContext = await loadEaBranchInvitationEmailContext(
      supabase,
      invitationId,
      invitationLink
    );

    if (!emailContext) {
      return NextResponse.json({
        ok: false,
        sent: false,
        error: "invitation_context_unavailable",
      });
    }

    const result = await sendEstateAgentInvitation(emailContext, {
      sentBy: user.id,
      invitationId,
    });

    if (result.ok && result.sent) {
      const recordResult = await recordEaBranchInvitationSent(
        supabase,
        invitationId
      );

      if (!recordResult.ok) {
        console.error(
          "[communications] Failed to record branch invitation sent:",
          recordResult.error
        );
      }
    }

    if (!result.ok) {
      console.error(
        "[communications] Estate agent invitation email failed:",
        result.error
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[communications] Estate agent invitation route exception:",
      error
    );

    return NextResponse.json({
      ok: false,
      sent: false,
      error: "unexpected_error",
    });
  }
}
