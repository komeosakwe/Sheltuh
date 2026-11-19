import { parseUsername } from "@/lib/username";
import { containsLink } from "./profile-input";
import { fail } from "./validation";

/**
 * The `username` of PUT /api/me/username and POST /api/me/username/check:
 * lib/username.ts's rules (shared with the settings form), plus no name that
 * reads as a web address ("mia.com", "www.mia"; containsLink, as for display
 * names). Returns the normalised name, or fails with fieldErrors.username
 * (400). The name itself is never logged.
 */
export function parseUsernameInput(body: Record<string, unknown>): string {
  const parsed = parseUsername(body.username);
  if (!parsed.ok) fail({ username: parsed.error });
  if (containsLink(parsed.value)) fail({ username: "Usernames can't look like a web address." });
  return parsed.value;
}
