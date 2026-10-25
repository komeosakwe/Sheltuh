/**
 * Supabase Auth's admin API, for account invites only (docs/architecture.md,
 * "Account invites"): when an invitee presses "Create account" on our
 * `/invite` page, the server asks Supabase Auth for a sign-up token for the
 * invite's address, just in time, and hands its hash to that browser, which
 * verifies it (`verifyOtp`, type `invite`) and sets a password. Supabase
 * sends no email here: the invite email is our own (lib/server/invite-email.ts).
 *
 * The only module that reads SUPABASE_ADMIN_INVITE_KEY: a dedicated Supabase
 * secret key (sb_secret_…), separately revocable, used for nothing else. It
 * is sent to Supabase only, never logged, and never in an error message.
 * Without it (or NEXT_PUBLIC_SUPABASE_URL), createAuthAdmin returns
 * undefined: the invite routes that need it answer 503 and the invite page
 * falls back to the ordinary sign-up (acceptance only needs a verified email).
 *
 * Talks to Supabase Auth's REST API with fetch (no dependency), as
 * @supabase/auth-js sends it (node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts
 * `generateLink`, lib/fetch.ts `_generateLinkResponse`):
 *   POST   {project}/auth/v1/admin/generate_link  {type: "invite", email}
 *     → the user (`id`, …), with the link's properties (`hashed_token`, …) at the top level
 *   DELETE {project}/auth/v1/admin/users/{id}  {should_soft_delete: false}
 *     (`deleteUser`: a hard delete, so the address is free again)
 * with `apikey` and `Authorization: Bearer` set to the key (what supabase-js
 * sends for the auth admin API) and `X-Supabase-Api-Version: 2024-01-01`, so
 * an error's machine-readable code is in `code`. No `data`: we never write
 * user_metadata (never used for authorisation, docs/architecture.md).
 * Redirects are refused (`redirect: "error"`): the headers carry the key.
 * In production the project URL must be https, or there's no client.
 */

import { isUuid } from "./pagination";

/** Per request: one small JSON call to Supabase Auth, in the same region. */
const TIMEOUT_MS = 10_000;

/** Supabase Auth's codes for "an account with this address already exists". */
const EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);

/**
 * The token hash's shape isn't documented, so this is deliberately loose: URL-safe
 * characters only (it goes back to the browser as JSON, and then to Supabase).
 */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/** A Supabase Auth admin call failed (network, timeout, an unexpected status or answer). Its message never holds the key, the address or a token. */
export class AuthAdminError extends Error {
  constructor(
    readonly operation: string,
    readonly status?: number,
  ) {
    super(`Supabase Auth ${operation} failed${status === undefined ? "" : ` (HTTP ${status})`}.`);
    this.name = "AuthAdminError";
  }
}

export interface AuthAdmin {
  /**
   * A sign-up ("invite") token for `email`: its hash, which the browser
   * passes to `verifyOtp({token_hash, type: "invite"})`, and the account it's
   * for. Supabase Auth creates the (unconfirmed, passwordless) account if
   * there's none, or reuses an unconfirmed one as it is (password included:
   * the caller deletes those first, lib/server/handlers/invites.ts). "exists":
   * the address already has a confirmed account (the person signs in
   * instead). Throws AuthAdminError otherwise.
   */
  generateInviteLink(email: string): Promise<{ tokenHash: string; userId: string } | "exists">;
  /**
   * Deletes account `userId` for good (not a soft delete). Resolves when it's
   * gone, also if it already was (404). Throws AuthAdminError otherwise. The
   * caller decides it may be deleted: Supabase deletes any account.
   */
  deleteUser(userId: string): Promise<void>;
}

/**
 * The client, or undefined when SUPABASE_ADMIN_INVITE_KEY or
 * NEXT_PUBLIC_SUPABASE_URL is unset, the URL isn't one, or (in production)
 * it isn't https (logged). `fetchImpl` is for tests.
 */
export function createAuthAdmin(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): AuthAdmin | undefined {
  const key = env.SUPABASE_ADMIN_INVITE_KEY?.trim();
  const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!key || !projectUrl) return undefined;
  let admin: URL;
  try {
    admin = new URL(`${projectUrl.replace(/\/+$/, "")}/auth/v1/admin`);
  } catch {
    return undefined;
  }
  if (env.NODE_ENV === "production" && admin.protocol !== "https:") {
    // The key would cross the network in the clear. The URL isn't secret, but isn't needed here.
    console.error("NEXT_PUBLIC_SUPABASE_URL isn't https: the invite page's account setup is off.");
    return undefined;
  }
  const root = admin.href;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    "x-supabase-api-version": "2024-01-01",
  };

  async function call(operation: string, url: string, method: string, body: unknown): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method,
        headers,
        body: JSON.stringify(body),
        // Never follow a redirect: the headers carry the key.
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The cause (a network, redirect or timeout error) is dropped: it can quote the request.
      throw new AuthAdminError(operation);
    }
  }

  return {
    async generateInviteLink(email) {
      const res = await call("generate_link", `${root}/generate_link`, "POST", { type: "invite", email });

      // Parsed, never logged: a success holds the user's details and the token.
      const body: unknown = await res.json().catch(() => undefined);
      const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

      if (!res.ok) {
        const code = typeof fields.code === "string" ? fields.code : fields.error_code;
        if (res.status === 422 && typeof code === "string" && EXISTS_CODES.has(code)) return "exists";
        throw new AuthAdminError("generate_link", res.status);
      }

      const tokenHash = fields.hashed_token;
      const userId = fields.id;
      if (
        typeof tokenHash !== "string" ||
        !TOKEN_HASH_PATTERN.test(tokenHash) ||
        typeof userId !== "string" ||
        !isUuid(userId)
      ) {
        throw new AuthAdminError("generate_link", res.status);
      }
      return { tokenHash, userId };
    },

    async deleteUser(userId) {
      // Checked before it goes in the path.
      if (!isUuid(userId)) throw new AuthAdminError("delete_user");
      const res = await call("delete_user", `${root}/users/${userId}`, "DELETE", { should_soft_delete: false });
      // Never read: a success echoes the user.
      await res.body?.cancel().catch(() => {});
      if (res.ok || res.status === 404) return;
      throw new AuthAdminError("delete_user", res.status);
    },
  };
}
