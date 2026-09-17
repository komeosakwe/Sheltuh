import { HttpError, type ApiEvent } from "./http";

/**
 * API Gateway's HTTP API JWT authorizer has already verified the token's
 * signature, issuer and expiry before the Lambda ever runs — these claims
 * are trustworthy. Handlers never parse or verify a token themselves.
 */
export function getClaims(event: ApiEvent): Record<string, unknown> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) {
    throw new HttpError(401, "Sign in required.");
  }
  return claims;
}

export function getCallerSub(event: ApiEvent): string {
  const claims = getClaims(event);
  const sub = claims.sub;
  if (typeof sub !== "string" || !sub) {
    throw new HttpError(401, "Sign in required.");
  }
  return sub;
}

export function getCallerEmail(event: ApiEvent): string | undefined {
  const claims = getClaims(event);
  return typeof claims.email === "string" ? claims.email : undefined;
}

/**
 * `cognito:groups` arrives as a JSON-array-shaped string (single or multiple
 * groups) depending on how many groups the user belongs to. Handle both
 * shapes rather than assuming one.
 */
export function getCallerGroups(event: ApiEvent): string[] {
  const claims = getClaims(event);
  const raw = claims["cognito:groups"];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — a single group can arrive as a bare string.
      return [raw];
    }
  }
  return [];
}

export function requireAdmin(event: ApiEvent): string {
  const sub = getCallerSub(event);
  if (!getCallerGroups(event).includes("admins")) {
    throw new HttpError(403, "Admin access required.");
  }
  return sub;
}
