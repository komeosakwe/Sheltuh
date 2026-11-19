import { makesAClaim, skeleton } from "@/lib/lookalikes";

/**
 * Member usernames (docs/architecture.md, "Usernames"): the rules, shared by
 * the API (lib/server/username-input.ts adds the web-address check) and the
 * settings form. Plain string functions, safe in the browser.
 *
 * A username is 3 to 20 of a–z 0–9 _ . ; it starts and ends with a letter,
 * digit or _; no ".."; at least one letter; at most 4 digits; no claim words
 * (CLAIM_WORDS, lib/lookalikes.ts), nothing whose key contains "sheltuh",
 * and none of RESERVED_USERNAMES. Two names are the same name when their keys
 * are (usernameKey: "1atte", "lat.te" and "latte" are one). The database's
 * own floor is private.member_username_ok and private.member_username_key
 * (supabase/migrations/20261201000100_member_usernames.sql).
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
/** Most digits in a username (so it can't carry a phone number or a birth year and day). */
export const USERNAME_MAX_DIGITS = 4;

/**
 * Names nobody may take: every top-level page and API segment (so a name
 * never reads as a link to one), and words that would pass for Sheltüh's own
 * accounts or roles. Compared on usernameKey, and also with trailing digits,
 * dots and underscores dropped first ("admin2", "support_1"). Written as
 * matched: lower case, no . or _.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  // app/ top-level segments
  "about", "account", "admin", "api", "auth", "checkout", "community", "dashboard", "events", "following",
  "fonts", "forgotpassword", "help", "holdermessages", "invite", "login", "map", "members", "messages",
  "organisers", "partners", "privacy", "purchaseterms", "refunds", "saved", "search", "signedin", "signup",
  "swipe", "terms", "verify", "waitlist",
  // app/api/ segments not above
  "blocks", "conversations", "cron", "favourites", "follows", "invites", "me", "orders", "organiserlinks",
  "places", "profiles", "reports", "stripe",
  // Pages and words a member might expect
  "settings", "tickets", "ticket", "profile", "home", "new", "edit", "explore", "discover", "event",
  "organiser", "organizer", "organizers", "member", "user", "users", "username", "signin", "logout",
  "signout", "register", "join", "calendar", "notifications", "inbox", "feed",
  // Sheltüh's own accounts, roles and mailboxes
  "administrator", "support", "moderator", "mod", "mods", "staff", "team", "official", "helpdesk",
  "bookings", "business", "contact", "hello", "info", "legal", "security", "billing", "payments",
  "payouts", "noreply", "postmaster", "abuse", "webmaster", "root", "system", "owner", "founder",
  "everyone", "here", "all", "anonymous", "unknown", "null", "undefined", "deleted", "removed",
];

/**
 * The lookalike key two names are compared on: '.' and '_' dropped, then
 * skeleton() (i/l/1 → l, 0 → o, rn → m; on a valid name nothing else
 * applies). Mirrors private.member_username_key.
 */
export function usernameKey(username: string): string {
  return skeleton(username.replace(/[._]/g, ""));
}

const RESERVED_KEYS = new Set(RESERVED_USERNAMES.map(usernameKey));
const SHELTUH_KEY = usernameKey("sheltuh");

/** The longest input looked at, before any regex runs on it. */
const MAX_INPUT_LENGTH = 100;

/**
 * As typed to as stored: compatibility-folded (NFKC: fullwidth letters and
 * "＠" become ASCII), trimmed, one leading "@" dropped, lower case.
 */
export function normaliseUsername(value: string): string {
  const folded = value.normalize("NFKC").trim();
  return (folded.startsWith("@") ? folded.slice(1) : folded).toLowerCase();
}

export type UsernameResult = { ok: true; value: string } | { ok: false; error: string };

function isReserved(value: string): boolean {
  return RESERVED_KEYS.has(usernameKey(value)) || RESERVED_KEYS.has(usernameKey(value.replace(/[0-9_.]+$/, "")));
}

/**
 * A username as the member typed it: normalised (normaliseUsername) and
 * checked, or the message to show next to the field. The API also refuses
 * names that look like a web address (lib/server/username-input.ts).
 */
export function parseUsername(raw: unknown): UsernameResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a username." };
  if (raw.length > MAX_INPUT_LENGTH) return { ok: false, error: `Use ${USERNAME_MAX_LENGTH} characters or fewer.` };
  const value = normaliseUsername(raw);
  if (!value) return { ok: false, error: "Enter a username." };
  if (!/^[a-z0-9_.]+$/.test(value)) return { ok: false, error: "Use only letters a–z, numbers, _ and ." };
  if (value.length < USERNAME_MIN_LENGTH) return { ok: false, error: `Use at least ${USERNAME_MIN_LENGTH} characters.` };
  if (value.length > USERNAME_MAX_LENGTH) return { ok: false, error: `Use ${USERNAME_MAX_LENGTH} characters or fewer.` };
  if (value.startsWith(".") || value.endsWith(".")) return { ok: false, error: "Start and end with a letter, number or _." };
  if (value.includes("..")) return { ok: false, error: "Don't put two dots in a row." };
  if (!/[a-z]/.test(value)) return { ok: false, error: "Include at least one letter." };
  if ((value.match(/[0-9]/g)?.length ?? 0) > USERNAME_MAX_DIGITS) {
    return { ok: false, error: `Use ${USERNAME_MAX_DIGITS} numbers or fewer.` };
  }
  if (usernameKey(value).includes(SHELTUH_KEY)) return { ok: false, error: "Usernames can't include Sheltüh." };
  if (makesAClaim(value)) return { ok: false, error: "That username makes a claim we can't check. Try another." };
  if (isReserved(value)) return { ok: false, error: "That username is reserved. Try another." };
  return { ok: true, value };
}

/**
 * A username to offer, made from the member's display name only (never their
 * email): accents dropped, lower case, every run of anything else one "_",
 * cut to USERNAME_MAX_LENGTH ("Mia T." → "mia_t", "Zoë" → "zoe"). Null when
 * that isn't a valid username (too short, emoji only, reserved...).
 */
export function suggestUsername(displayName: string): string | null {
  const base = displayName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, USERNAME_MAX_LENGTH)
    .replace(/_+$/, "");
  const parsed = parseUsername(base);
  return parsed.ok ? parsed.value : null;
}
