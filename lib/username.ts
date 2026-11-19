import { CLAIM_WORDS, makesAClaim, skeleton } from "@/lib/lookalikes";

/**
 * Member usernames (docs/architecture.md, "Usernames"): the rules, shared by
 * the API (lib/server/username-input.ts adds the web-address check) and the
 * settings form. Plain string functions, safe in the browser.
 *
 * A username is 3 to 20 of a–z 0–9 _ . ; it starts and ends with a letter,
 * digit or _; no ".."; at least one letter; at most 4 digits; no claim words
 * (CLAIM_WORDS, lib/lookalikes.ts) as words, nor run together at either end
 * (EDGE_WORDS: "verifiedmia", "adminsupport", "2admin"); nothing whose key
 * contains "sheltuh" (or "sheltueh"); and none of RESERVED_USERNAMES. Those
 * brand checks also read 5/3/4/7 as s/e/a/t (brandKey). Two names are the
 * same name when their keys are (usernameKey: "1atte", "lat.te" and "latte"
 * are one; the digit folds are for the brand checks only). The database's
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

/**
 * usernameKey, plus the digits that pass for letters in a brand or a role
 * (5 → s, 3 → e, 4 → a, 7 → t): for the reserved, claim and Sheltüh checks
 * only, never for uniqueness ("m4ya" and "maya" are different names).
 */
export function brandKey(username: string): string {
  return usernameKey(username).replace(/[5347]/g, (d) => ({ "5": "s", "3": "e", "4": "a", "7": "t" })[d] ?? d);
}

/**
 * Staff and verification words a name may not start or end with, run
 * together or not ("adminsupport", "moderatorkate", "support.team"): with
 * CLAIM_WORDS, EDGE_WORDS. In the middle of a longer word they're fine
 * ("badminton").
 */
export const STAFF_WORDS: readonly string[] = [
  "admin", "administrator", "moderator", "support", "official", "helpdesk", "security", "staff", "verified", "sheltuh",
];

const RESERVED_KEYS = new Set(RESERVED_USERNAMES.map(brandKey));
const EDGE_KEYS = [...new Set([...CLAIM_WORDS, ...STAFF_WORDS].map(brandKey))];
const SHELTUH_KEYS = ["sheltuh", "sheltueh"].map(brandKey);

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

const CLAIM = "That username makes a claim we can't check. Try another.";

export type UsernameResult = { ok: true; value: string } | { ok: false; error: string };

/** The name's brand keys as it is and with leading and trailing digits, dots and underscores dropped ("2admin_" → "admin"). */
function brandKeys(value: string): string[] {
  return [brandKey(value), brandKey(value.replace(/^[0-9_.]+|[0-9_.]+$/g, ""))];
}

function isReserved(value: string): boolean {
  return brandKeys(value).some((key) => RESERVED_KEYS.has(key));
}

/** Starts or ends with a claim or staff word (EDGE_WORDS), run together or not. */
function startsOrEndsWithClaim(value: string): boolean {
  return brandKeys(value).some((key) => key && EDGE_KEYS.some((word) => key.startsWith(word) || key.endsWith(word)));
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
  const key = brandKey(value);
  if (SHELTUH_KEYS.some((brand) => key.includes(brand))) return { ok: false, error: "Usernames can't include Sheltüh." };
  if (makesAClaim(value)) return { ok: false, error: CLAIM };
  if (isReserved(value)) return { ok: false, error: "That username is reserved. Try another." };
  if (startsOrEndsWithClaim(value)) return { ok: false, error: CLAIM };
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
