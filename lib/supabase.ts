import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — persists auth session in cookies so middleware
 * (createServerClient) can read the same session on protected routes.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
