import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    NODE_ENV: process.env.NODE_ENV ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? null,
    RESEND_API_KEY_EXISTS: Boolean(
      process.env.RESEND_API_KEY?.trim()
    ),
    SUPABASE_SERVICE_ROLE_KEY_EXISTS: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    ),
  });
}
