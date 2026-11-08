import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ingestTarget, resolveAnalyticsConfig } from "@/lib/analytics-config";
import { CSP_HEADER, checkoutPayCsp } from "@/lib/csp";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * A Content Security Policy with a per-request nonce for the payment page
 * (lib/csp.ts; Next's CSP guide). The page renders per request (it awaits
 * connection()), and Next reads the nonce from the request's policy header and
 * puts it on its own scripts. Every other page keeps only next.config.ts's
 * site-wide `frame-ancestors 'none'`. And the usage analytics proxy, /ingest (below).
 */

/** app/layout.tsx inlines THEME_INIT_SCRIPT unchanged, so its hash allows it (it can't carry a nonce). */
const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT, "utf8").digest("base64")}'`;

/**
 * Usage analytics' first-party proxy (lib/analytics.ts sends to /ingest): PostHog
 * endpoints only, POST only, relayed to the configured PostHog host with the
 * visitor's cookies and Referer left out (the address of the page they were on is
 * in the event, already cleaned in the browser; the Referer would be the raw one).
 * With no NEXT_PUBLIC_POSTHOG_KEY there is nothing to relay to: 404.
 */
function ingest(request: NextRequest): NextResponse {
  const config = resolveAnalyticsConfig(process.env.NEXT_PUBLIC_POSTHOG_KEY, process.env.NEXT_PUBLIC_POSTHOG_HOST);
  const target = ingestTarget(request.nextUrl.pathname);
  const refuse = (status: number) => new NextResponse(null, { status, headers: { "X-Content-Type-Options": "nosniff" } });
  if (!config || !target) return refuse(404);
  if (request.method !== "POST") return refuse(405);
  const headers = new Headers(request.headers);
  for (const name of ["cookie", "referer", "origin", "authorization"]) headers.delete(name);
  const destination = new URL(target, config.apiHost);
  // PostHog's own query (ip, ver, compression…) is kept as the SDK sent it.
  destination.search = request.nextUrl.search;
  const response = NextResponse.rewrite(destination, { request: { headers } });
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
  return response;
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/ingest")) return ingest(request);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = checkoutPayCsp({
    nonce,
    themeScriptHash: THEME_SCRIPT_HASH,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  // Next takes the nonce from Content-Security-Policy first: never one the client sent.
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set(CSP_HEADER, policy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

export const config = {
  matcher: ["/checkout/pay", "/ingest/:path*"],
};
