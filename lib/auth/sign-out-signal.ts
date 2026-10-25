/**
 * Telling every tab that a sign-out was the person's own (Sign out, on
 * /account), rather than the session ending by itself (it expired, or its
 * refresh token was revoked). Supabase reports both the same way, as a
 * session that's gone. The difference matters to a page keeping a form on
 * screen through a sign-out (lib/auth/useKeptWhileSignedOut.ts): after an
 * expiry the draft is kept, so it can be finished after signing in again;
 * after someone signs themselves out, it's cleared from every tab.
 *
 * The tab signing out records it *before* asking Supabase to sign out: in
 * localStorage (which every tab reads when Supabase's sign-out reaches it,
 * and whose `storage` event is the fallback where there's no
 * BroadcastChannel), and on a BroadcastChannel (for a tab where Supabase's
 * sign-out arrived first). It says which account, and when (this device's
 * clock, which every tab shares): a tab counts it only for a session it has
 * seen begin before then, never for a later sign-in by the same account.
 */

const CHANNEL_NAME = "sheltuh-auth";
const STORAGE_KEY = "sheltuh:user-sign-out";

export interface UserSignOut {
  /** The Supabase user id of the account that signed out. */
  userId: string;
  /** When (`Date.now()`). */
  at: number;
}

function parse(value: unknown): UserSignOut | null {
  if (typeof value !== "object" || value === null) return null;
  const { userId, at } = value as Record<string, unknown>;
  return typeof userId === "string" && typeof at === "number" ? { userId, at } : null;
}

function parseJson(text: string | null): UserSignOut | null {
  if (!text) return null;
  try {
    return parse(JSON.parse(text));
  } catch {
    return null; // Not ours (or damaged): no sign-out recorded.
  }
}

/** Whether `signal` is `userId`'s own sign-out of a session this tab saw begin at `since` (or earlier). */
export function endsSession(signal: UserSignOut | null, userId: string | undefined, since: number): boolean {
  return Boolean(signal && userId && signal.userId === userId && signal.at >= since);
}

/** Records, for every tab, that `userId` is signing themselves out now. Call it before signing out. */
export function announceUserSignOut(userId: string, now: number = Date.now()): void {
  const signal: UserSignOut = { userId, at: now };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signal));
  } catch {
    // Storage can be unavailable (blocked, full): the BroadcastChannel below
    // still reaches open tabs, and signing out goes ahead either way.
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(signal);
    channel.close();
  }
}

/** The last recorded sign-out, if any (for a tab that has just heard its session has gone). */
export function lastUserSignOut(): UserSignOut | null {
  try {
    return parseJson(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Calls `listener` when a sign-out is recorded: by BroadcastChannel where
 * there is one (which also delivers this tab's own, harmlessly), otherwise by
 * the `storage` event (another tab's only). Returns the unsubscribe.
 */
export function onUserSignOut(listener: (signal: UserSignOut) => void): () => void {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const signal = parse(event.data);
      if (signal) listener(signal);
    };
    return () => channel.close();
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const signal = parseJson(event.newValue);
    if (signal) listener(signal);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
