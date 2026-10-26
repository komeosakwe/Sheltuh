import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { CSP_HEADER, checkoutPayCsp } from "@/lib/csp";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * A Content Security Policy with a per-request nonce for the payment page
 * (lib/csp.ts; Next's CSP guide). The page renders per request (it awaits
 * connection()), and Next reads the nonce from the request's policy header and
 * puts it on its own scripts. Every other page keeps only next.config.ts's
 * site-wide `frame-ancestors 'none'`.
 */

/** app/layout.tsx inlines THEME_INIT_SCRIPT unchanged, so its hash allows it (it can't carry a nonce). */
const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT, "utf8").digest("base64")}'`;

export function proxy(request: NextRequest) {
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
  matcher: ["/checkout/pay"],
};
