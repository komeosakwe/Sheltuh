// Access tokens for the scenarios that need an account (door check-in, free
// ticket claims). Either given ready-made (ORGANISER_TOKEN, a MEMBER_TOKENS_FILE)
// or got in setup() by signing the seeded staging accounts in with Supabase
// Auth's password grant. Tokens and passwords are never logged or written.
import http from "k6/http";
import { parseBaseUrl, isLocalHost } from "./target.js";

/** "mia@example.com" → "m***@example.com", for messages. */
export function maskEmail(email) {
  const at = String(email).indexOf("@");
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***";
}

/**
 * The staging Supabase project's URL and publishable key, checked: https
 * (or local), and not the production project (PRODUCTION_SUPABASE_REF, when
 * set, is a project ref the URL must not contain).
 */
export function supabaseAuthConfig(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Signing in needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the staging project's), or ready-made tokens.");
  }
  const { origin, host, protocol } = parseBaseUrl(url);
  if (protocol !== "https" && !isLocalHost(host)) throw new Error("SUPABASE_URL must be https.");
  const prodRef = String(env.PRODUCTION_SUPABASE_REF || "").trim().toLowerCase();
  if (prodRef && host.indexOf(prodRef) !== -1) {
    throw new Error("SUPABASE_URL is the production Supabase project (PRODUCTION_SUPABASE_REF). Use the staging project.");
  }
  return { origin, key };
}

/** One account's access token, by password (Supabase Auth). Throws on failure, naming only the masked email. */
export function signIn(env, email, password) {
  const { origin, key } = supabaseAuthConfig(env);
  const res = http.post(`${origin}/auth/v1/token?grant_type=password`, JSON.stringify({ email, password }), {
    headers: { apikey: key, "Content-Type": "application/json" },
    tags: { rg: "auth", name: "supabase password sign-in" },
    timeout: "20s",
  });
  if (res.status !== 200) {
    throw new Error(
      `Signing in ${maskEmail(email)} failed: HTTP ${res.status}` +
        (res.status === 429 ? " (Supabase Auth's sign-in rate limit: wait, or use MEMBERS_MAX / ready-made tokens)" : ""),
    );
  }
  let token;
  try {
    token = res.json("access_token");
  } catch {
    token = undefined;
  }
  if (typeof token !== "string" || token === "") throw new Error(`Signing in ${maskEmail(email)} returned no access token.`);
  return token;
}

/** The organiser's token: ORGANISER_TOKEN, else ORGANISER_EMAIL + ORGANISER_PASSWORD signed in. */
export function organiserToken(env) {
  if (env.ORGANISER_TOKEN) return env.ORGANISER_TOKEN;
  if (env.ORGANISER_EMAIL && env.ORGANISER_PASSWORD) return signIn(env, env.ORGANISER_EMAIL, env.ORGANISER_PASSWORD);
  throw new Error("The door scenario needs ORGANISER_TOKEN, or ORGANISER_EMAIL and ORGANISER_PASSWORD (the seeded staging organiser).");
}

/**
 * Member accounts with tokens, `[{email, token}]`: `tokenList` as given
 * (MEMBER_TOKENS_FILE), else each of `memberList` (the seed's members file)
 * signed in with MEMBER_PASSWORD, at most MEMBERS_MAX (default 25: Supabase
 * Auth limits sign-ins per IP address).
 */
export function memberTokens(env, memberList, tokenList) {
  if (tokenList && tokenList.length > 0) {
    return tokenList.filter((m) => m && typeof m.email === "string" && typeof m.token === "string");
  }
  if (!memberList || memberList.length === 0) return [];
  if (!env.MEMBER_PASSWORD) throw new Error("Members need MEMBER_PASSWORD (the password the seed gave them), or a MEMBER_TOKENS_FILE.");
  const max = Number(env.MEMBERS_MAX || 25);
  return memberList.slice(0, max).map((m) => ({ email: m.email, token: signIn(env, m.email, env.MEMBER_PASSWORD) }));
}
