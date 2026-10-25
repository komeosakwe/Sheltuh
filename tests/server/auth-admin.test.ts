import { describe, expect, it, vi } from "vitest";
import { AuthAdminError, createAuthAdmin, type AuthAdmin } from "@/lib/server/auth-admin";

/**
 * lib/server/auth-admin.ts against a stubbed fetch: Supabase Auth's
 * generate_link as @supabase/auth-js sends it. Real Supabase Auth isn't
 * reached here (its behaviour with an sb_secret_ key is a go-live smoke test,
 * docs/supabase-setup.md).
 */

const KEY = "sb_secret_invites_test_not_real";
const ENV = { SUPABASE_ADMIN_INVITE_KEY: KEY, NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.test/" };
const ENDPOINT = "https://ref.supabase.test/auth/v1/admin/generate_link";
const EMAIL = "invitee@example.com";
const HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init ?? {}));
  const admin = createAuthAdmin(ENV, fetch as unknown as typeof globalThis.fetch) as AuthAdmin;
  return { admin, fetch };
}

describe("createAuthAdmin", () => {
  it("is undefined without the key or the project URL (or with a URL that isn't one)", () => {
    expect(createAuthAdmin({})).toBeUndefined();
    expect(createAuthAdmin({ NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL })).toBeUndefined();
    expect(createAuthAdmin({ SUPABASE_ADMIN_INVITE_KEY: KEY })).toBeUndefined();
    expect(createAuthAdmin({ ...ENV, SUPABASE_ADMIN_INVITE_KEY: "  " })).toBeUndefined();
    expect(createAuthAdmin({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toBeUndefined();
    expect(createAuthAdmin(ENV)).toBeDefined();
  });

  it("doesn't read the clip storage key or the scripts' secret key", () => {
    expect(
      createAuthAdmin({
        NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_CLIP_STORAGE_KEY: KEY,
        SUPABASE_SECRET_KEY: KEY,
      }),
    ).toBeUndefined();
  });

  it("asks for an invite link: POST /auth/v1/admin/generate_link {type, email}, the key as apikey and bearer", async () => {
    const { admin, fetch } = client(() =>
      json({ id: "u1", email: EMAIL, action_link: "https://ref.supabase.test/auth/v1/verify?token=x", hashed_token: HASH }),
    );
    expect(await admin.generateInviteLink(EMAIL)).toEqual({ tokenHash: HASH });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "x-supabase-api-version": "2024-01-01",
    });
    // No `data` (user_metadata) and no redirect: only what's needed.
    expect(JSON.parse(init?.body as string)).toEqual({ type: "invite", email: EMAIL });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a 422 email_exists / user_already_exists (new or old error format) to 'exists'", async () => {
    for (const body of [
      { code: "email_exists", msg: "A user with this email address has already been registered" },
      { code: "user_already_exists", msg: "User already registered" },
      { code: 422, error_code: "email_exists", msg: "…" },
    ]) {
      const { admin } = client(() => json(body, 422));
      expect(await admin.generateInviteLink(EMAIL)).toBe("exists");
    }
  });

  it("throws AuthAdminError for any other failure, with the status", async () => {
    const cases: [Response, number | undefined][] = [
      [json({ code: "validation_failed", msg: "Unable to validate email address" }, 422), 422],
      [json({ code: "email_exists" }, 400), 400],
      [json({ msg: "Invalid API key" }, 401), 401],
      [json({ msg: "boom" }, 500), 500],
      [new Response("<html>bad gateway</html>", { status: 502 }), 502],
      // A success without a usable token hash.
      [json({ id: "u1" }), 200],
      [json({ hashed_token: "has spaces and / slashes" }), 200],
      [json({ hashed_token: "short" }), 200],
      [new Response("not json", { status: 200 }), 200],
    ];
    for (const [response, status] of cases) {
      const { admin } = client(() => response);
      const err = await admin.generateInviteLink(EMAIL).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthAdminError);
      expect(err).toMatchObject({ operation: "generate_link", status });
    }
  });

  it("never puts the key, the address or a token in an error", async () => {
    const { admin } = client(() => {
      throw new Error(`connect failed for ${ENDPOINT} apikey=${KEY} email=${EMAIL}`);
    });
    const err = await admin.generateInviteLink(EMAIL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthAdminError);
    expect((err as Error).message).toBe("Supabase Auth generate_link failed.");

    const echoing = client(() => json({ msg: `bad request for ${EMAIL} with ${KEY}`, hashed_token: HASH }, 400));
    const err2 = await echoing.admin.generateInviteLink(EMAIL).catch((e: unknown) => e);
    expect((err2 as Error).message).toBe("Supabase Auth generate_link failed (HTTP 400).");
    for (const e of [err, err2]) {
      const text = `${(e as Error).message} ${JSON.stringify(e)} ${String((e as Error).stack)}`;
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(HASH);
    }
  });
});
