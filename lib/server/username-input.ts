import { SPOKEN_TLDS } from "@/lib/contact-detail";
import { parseUsername } from "@/lib/username";
import { containsLink } from "./profile-input";
import { fail } from "./validation";

/**
 * TLDs a dotted part of a username may not be ("mia.top", "is.gd",
 * "mia.co.uk"): lib/contact-detail.ts's list, plus .ee and .gy.
 */
const USERNAME_TLDS = new Set([...SPOKEN_TLDS.split("|"), "ee", "gy"]);

/** Reads as a web address: containsLink ("www.mia", "mia.com"), or a part after a dot is a TLD (underscores around it ignored). */
export function usernameLooksLikeAddress(username: string): boolean {
  if (containsLink(username)) return true;
  return username
    .split(".")
    .slice(1)
    .some((label) => USERNAME_TLDS.has(label.replace(/^_+|_+$/g, "")));
}

/**
 * The `username` of PUT /api/me/username and POST /api/me/username/check:
 * lib/username.ts's rules (shared with the settings form), plus no name that
 * reads as a web address (usernameLooksLikeAddress). Returns the normalised
 * name, or fails with fieldErrors.username (400). The name itself is never
 * logged.
 */
export function parseUsernameInput(body: Record<string, unknown>): string {
  const parsed = parseUsername(body.username);
  if (!parsed.ok) fail({ username: parsed.error });
  if (usernameLooksLikeAddress(parsed.value)) fail({ username: "Usernames can't look like a web address." });
  return parsed.value;
}
