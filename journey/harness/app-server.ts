import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type Stripe from "stripe";
import { getDeps } from "@/lib/server/deps";

/**
 * The app's API over real HTTP, without `next start`: every
 * app/api/** /route.ts module is loaded as is and called the way Next calls
 * it (`GET(request, { params: Promise })`), so requests go through the real
 * route() wrapper, the real getDeps() (postgres.js on DATABASE_URL,
 * supabase-js against the auth stub, nodemailer against the SMTP sink, the
 * env secrets) and the real handlers.
 *
 * Exactly two things on the production Deps are swapped, because they can't
 * run outside Next or without reaching Stripe:
 * - `stripe()`: the real Stripe SDK pointed at the local fake API
 *   (sk_test_ keys only, D9). The app has no STRIPE_API_BASE override, so
 *   `next start` can't be pointed at a fake Stripe without changing
 *   production code: see docs/testing.md.
 * - `defer()`: Next's after() needs Next's request scope. The harness runs
 *   the tasks after the response has been written, as after() does, logging
 *   failures the same way.
 */

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];
type RouteFn = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteEntry {
  /** e.g. ["api", "events", "[eventId]", "checkout"] */
  segments: string[];
  file: string;
  methods: Set<Method>;
  module?: Promise<Partial<Record<Method, RouteFn>>>;
}

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findRouteFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** The route table, from the files themselves (methods from their `export const GET = …` lines). */
export function loadRouteTable(): RouteEntry[] {
  return findRouteFiles(path.join(APP_DIR, "api")).map((file) => {
    const source = readFileSync(file, "utf8");
    const methods = new Set(METHODS.filter((m) => new RegExp(`^export const ${m}\\s*=`, "m").test(source)));
    const segments = path.relative(APP_DIR, path.dirname(file)).split(path.sep);
    return { segments, file, methods };
  });
}

/** The matching route and its params; a static segment beats a dynamic one at the same position, as in Next. */
function match(table: RouteEntry[], pathname: string): { entry: RouteEntry; params: Record<string, string> } | undefined {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  let best: { entry: RouteEntry; params: Record<string, string>; score: string } | undefined;
  for (const entry of table) {
    if (entry.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let score = "";
    let ok = true;
    entry.segments.forEach((segment, i) => {
      const dynamic = segment.match(/^\[(\w+)\]$/);
      if (dynamic) {
        params[dynamic[1]] = parts[i];
        score += "0";
      } else if (segment === parts[i]) {
        score += "1";
      } else {
        ok = false;
      }
    });
    if (ok && (!best || score > best.score)) best = { entry, params, score };
  }
  return best;
}

export class AppServer {
  port = 0;
  readonly table = loadRouteTable();
  private server?: Server;
  private readonly scope = new AsyncLocalStorage<(() => Promise<void>)[]>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly stripe: Stripe) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    // The production wiring, read from the environment the harness set up; then the two swaps above.
    const deps = getDeps();
    deps.stripe = () => this.stripe;
    deps.defer = (task) => {
      const queue = this.scope.getStore();
      if (queue) queue.push(task);
      else this.track(task); // deferred from a deferred task: run it straight away
    };

    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await this.idle();
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  /** Waits for every deferred task (ticket emails, ops alerts…) started so far, and any they start. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private track(task: () => Promise<void>) {
    const run = (async () => {
      try {
        await task();
      } catch (err) {
        // As deps.defer logs it in production.
        console.error("Deferred task failed:", err instanceof Error ? err.message : "unknown error");
      }
    })();
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.baseUrl);
    const method = (req.method ?? "GET").toUpperCase() as Method;
    const found = match(this.table, url.pathname);
    if (!found) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "No such route." }));
    }
    if (!found.entry.methods.has(method)) {
      res.writeHead(405, { allow: [...found.entry.methods].join(", ") });
      return res.end();
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
    }
    const body = method === "GET" || (method === "DELETE" && chunks.length === 0) ? undefined : Buffer.concat(chunks);
    const request = new Request(url, { method, headers, body });

    found.entry.module ??= import(/* @vite-ignore */ found.entry.file) as Promise<Partial<Record<Method, RouteFn>>>;
    const routeFn = (await found.entry.module)[method]!;
    const tasks: (() => Promise<void>)[] = [];
    let response: Response;
    try {
      response = await this.scope.run(tasks, () => routeFn(request, { params: Promise.resolve(found.params) }));
    } catch (err) {
      // route() never throws; if it did, Next would answer 500.
      console.error("Route threw:", err instanceof Error ? err.message : "unknown error");
      response = new Response(null, { status: 500 });
    }
    const out = Buffer.from(await response.arrayBuffer());
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => (outHeaders[name] = value));
    if (tasks.length > 0) {
      // After the response, as after() does: in order, one at a time. Tracked before the response goes out,
      // so idle() called as soon as the client has it still waits for them.
      const sent = new Promise<void>((resolve) => res.once("close", resolve));
      this.track(async () => {
        await sent;
        for (const task of tasks) {
          try {
            await task();
          } catch (err) {
            console.error("Deferred task failed:", err instanceof Error ? err.message : "unknown error");
          }
        }
      });
    }
    res.writeHead(response.status, outHeaders);
    res.end(out);
  }
}
