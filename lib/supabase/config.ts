/**
 * Both are public by design (the publishable key only reaches what RLS
 * allows, which for this app's tables is nothing — see
 * supabase/migrations/). Unset in local/demo mode.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
