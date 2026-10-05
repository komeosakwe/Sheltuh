const PLACEHOLDER_ORIGIN = "https://sheltuh.invalid";
const MAX_LENGTH = 2048;
// Control characters and whitespace (browsers strip tabs/newlines from URLs,
// which can turn "/\t/evil.example" into "//evil.example").
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\s\\]/u;

/**
 * The `?next=` return path after signing in, if it's safe: a same-site
 * relative path ("/events/x?y#z"). Anything else (absolute or
 * protocol-relative URLs, "//host", backslashes, control characters,
 * "javascript:" and the like) returns null so the caller falls back to its
 * default.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (UNSAFE_CHARACTERS.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  // Re-serialised from the parsed URL, so what's navigated to is exactly
  // what was checked. Dot segments are resolved while parsing, so
  // "/.//evil.example", "/a/..//evil.example" and "/%2e//evil.example" all
  // come out as "//evil.example": a protocol-relative URL to another site.
  // The result is checked again, not just the input.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  return path;
}

/**
 * `path` with the return path carried along as `?next=`, so it survives the
 * hops between sign in, sign up, verify and password reset. An unsafe or
 * missing `next` is dropped. `params` are any other query parameters.
 */
export function withNext(path: string, next: unknown, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  const safe = safeNextPath(next);
  if (safe) query.set("next", safe);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
