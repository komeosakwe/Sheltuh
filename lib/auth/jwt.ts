/**
 * Decodes a JWT payload for UI purposes only (e.g. "show the admin nav
 * link"). This is never a security boundary — every protected API route
 * re-verifies the token's signature server-side via API Gateway's Cognito
 * authorizer before trusting anything in it.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | undefined {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export function getGroupsFromClaims(claims: Record<string, unknown> | undefined): string[] {
  const raw = claims?.["cognito:groups"];
  if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === "string");
  return [];
}
