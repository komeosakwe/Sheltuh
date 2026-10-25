/**
 * Telling accounts apart, for the session-expiry recovery guard
 * (components/auth/InlineReauth.tsx): a draft written as one account is only
 * ever resumed as that same account.
 */

/** Who an account is: its Supabase user id and, as a fallback (and for display), its email. */
export interface AccountRef {
  userId?: string;
  email?: string;
}

function normalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether `a` is the account `b`. By user id when both have one (an email can
 * change, and ids never collide); otherwise by email, ignoring case and
 * surrounding spaces. Nothing known about either side is never a match.
 */
export function sameAccount(a: AccountRef | undefined, b: AccountRef | undefined): boolean {
  if (!a || !b) return false;
  if (a.userId && b.userId) return a.userId === b.userId;
  return a.email !== undefined && b.email !== undefined && normalEmail(a.email) === normalEmail(b.email);
}

/**
 * A string naming the signed-in account (its user id, else its email), for
 * telling "this account's data" from another's (a React key, a cache tag);
 * null when nobody is signed in.
 */
export function accountKey(auth: { status: string; userId?: string; email?: string }): string | null {
  return auth.status === "signed-in" ? (auth.userId ?? auth.email ?? "") : null;
}
