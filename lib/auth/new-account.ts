/** How close an account's creation and its latest sign-in are for it to be the sign-in that created it. */
export const NEW_ACCOUNT_WINDOW_MS = 60_000;

/**
 * Whether this sign-in created the account: its `created_at` and `last_sign_in_at` (Supabase sets both
 * at the same moment for a first sign-in) are within a minute. A returning member, or an existing
 * email account a Google / Apple sign-in was linked to, is created long before. Used for usage
 * analytics only (sign_up_completed vs signed_in after an OAuth callback).
 */
export function isNewAccount(user: { created_at?: string; last_sign_in_at?: string } | null | undefined): boolean {
  if (!user?.created_at || !user.last_sign_in_at) return false;
  const created = Date.parse(user.created_at);
  const signedIn = Date.parse(user.last_sign_in_at);
  if (Number.isNaN(created) || Number.isNaN(signedIn)) return false;
  return Math.abs(signedIn - created) <= NEW_ACCOUNT_WINDOW_MS;
}
