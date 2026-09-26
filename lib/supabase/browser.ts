"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | undefined;

/**
 * The browser's Supabase client — used for auth only. The session lives in
 * localStorage and is sent to this app's own API as a bearer token; data
 * never goes through Supabase's Data API.
 */
export function getSupabaseBrowserClient(): SupabaseClient | undefined {
  if (!isSupabaseConfigured) return undefined;
  client ??= createClient(SUPABASE_URL as string, SUPABASE_PUBLISHABLE_KEY as string, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
