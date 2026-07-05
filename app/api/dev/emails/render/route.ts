import { NextResponse } from "next/server";

import { isDeveloperEmailToolsEnabled } from "@/lib/communications/config";
import { renderEmailTemplateById } from "@/lib/communications/render";
import { isEmailTemplateId } from "@/lib/communications/templateRegistry";

export async function GET(request: Request) {
  if (!isDeveloperEmailToolsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const template = searchParams.get("template");
  const format = searchParams.get("format") ?? "html";

  if (!isEmailTemplateId(template)) {
    return NextResponse.json(
      { error: "invalid_template" },
      { status: 400 }
    );
  }

  try {
    const rendered = await renderEmailTemplateById(template);

    if (format === "text") {
      return NextResponse.json({
        template,
        format: "text",
        subject: rendered.subject,
        content: rendered.text,
      });
    }

    if (format === "html-source") {
      return NextResponse.json({
        template,
        format: "html-source",
        subject: rendered.subject,
        content: rendered.html,
      });
    }

    return NextResponse.json({
      template,
      format: "html",
      subject: rendered.subject,
      content: rendered.html,
    });
  } catch (error) {
    console.error("[communications] Dev email render failed:", error);
    return NextResponse.json(
      { error: "render_failed" },
      { status: 500 }
    );
  }
}
