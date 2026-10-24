"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client — used for auth only. The session lives in
 * localStorage and is sent to this app's own API as a bearer token; data
 * never goes through Supabase's Data API.
 *
 * PKCE, for signing in with Google or Apple (lib/auth/oauth.ts): the
 * provider sends back a one-time code, which only this browser (holding the
 * verifier) can exchange. `detectSessionInUrl` stays off, so the only place
 * a code is ever exchanged is /auth/callback (components/auth/
 * OAuthCallback.tsx). The email flows (sign-up, resend, password reset) also
 * send a code challenge now; their emailed codes are still verified with
 * `verifyOtp`, which PKCE doesn't change.
 */
export function getSupabaseBrowserClient(): SupabaseClient | undefined {
  if (!isSupabaseConfigured) return undefined;
  client ??= createClient(SUPABASE_URL as string, SUPABASE_PUBLISHABLE_KEY as string, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
  });
  return client;
}
