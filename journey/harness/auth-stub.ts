import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type postgres from "postgres";

/**
 * Supabase Auth's `GET /auth/v1/user`, the one endpoint the API calls (the
 * production verifyAccessToken in lib/server/deps.ts, through supabase-js's
 * auth.getUser). Bearer tokens are opaque strings the harness hands out; the
 * user behind one is read from the database's auth.users on every request,
 * so a role or confirmation changed there applies at once, as in production.
 * It also checks the app sends the project's publishable key. Not GoTrue:
 * sign-in, sessions, JWTs and email confirmation are Supabase's own (layer d
 * in docs/testing.md).
 */
export class AuthStub {
  port = 0;
  /** GET /auth/v1/user requests answered (any outcome). */
  lookups = 0;
  private server?: Server;
  private readonly tokens = new Map<string, string>();

  constructor(
    private readonly sql: postgres.Sql,
    private readonly publishableKey: string,
  ) {}

  /** A bearer token for `userId`. Revoke it to simulate a signed-out or expired session. */
  issue(userId: string): string {
    const token = `journey-${crypto.randomUUID()}`;
    this.tokens.set(token, userId);
    return token;
  }

  revoke(token: string) {
    this.tokens.delete(token);
  }

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const path = new URL(req.url ?? "/", "http://stub").pathname;
      if (req.method !== "GET" || path !== "/auth/v1/user") return reply(404, { code: 404, msg: "Not found" });
      this.lookups += 1;
      if (req.headers.apikey !== this.publishableKey) return reply(401, { code: 401, error_code: "no_api_key", msg: "Invalid API key" });
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const userId = token ? this.tokens.get(token) : undefined;
      if (!userId) return reply(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT: unable to parse or verify signature" });
      try {
        const [user] = await this.sql<{ id: string; email: string | null; email_confirmed_at: Date | null; raw_app_meta_data: unknown }[]>`
          select id, email, email_confirmed_at, raw_app_meta_data from auth.users where id = ${userId}`;
        if (!user) return reply(403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" });
        return reply(200, {
          id: user.id,
          aud: "authenticated",
          role: "authenticated",
          email: user.email,
          email_confirmed_at: user.email_confirmed_at ? user.email_confirmed_at.toISOString() : null,
          app_metadata: user.raw_app_meta_data ?? {},
          user_metadata: {},
          created_at: new Date(0).toISOString(),
        });
      } catch {
        return reply(500, { code: 500, msg: "stub failure" });
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
