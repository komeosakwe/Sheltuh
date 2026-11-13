// Where a load test may point, and what it may do there. Plain JavaScript
// with no k6 imports, so tests/load/k6-scripts.test.ts can unit-test it.
//
// Rules (tests/load/README.md, "Safety"):
// - BASE_URL defaults to a local server, never to production.
// - A production host (sheltuh.com.au, findyoursheltuh.com.au, any of their
//   subdomains, and anything in PRODUCTION_HOSTS) is refused unless
//   ALLOW_PRODUCTION=1 AND the scenario can run read-only. Then the run is
//   read-only: GET and HEAD only, no view beacons.
// - Stripe's webhook and the cron routes are never requested, by any scenario.

export const DEFAULT_BASE_URL = "http://localhost:3000";

/** Production domains. Subdomains count too (www., preview.: previews share production's database). */
export const PRODUCTION_DOMAINS = ["sheltuh.com.au", "findyoursheltuh.com.au"];

/** Paths no load test may ever request, whatever the method. */
const FORBIDDEN_PATHS = [/^\/api\/stripe\/webhook(\/|\?|$)/i, /^\/api\/cron(\/|\?|$)/i];

/**
 * `BASE_URL` split into its parts: an http(s) origin with an optional port,
 * no user info, path, query or fragment. Throws with a readable message.
 */
export function parseBaseUrl(raw) {
  const text = String(raw).trim().replace(/\/+$/, "");
  const match = /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[^\s/?#@:[\]]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) {
    throw new Error(
      `BASE_URL must be an origin like https://my-preview.vercel.app (no path, query or user info). Got: ${JSON.stringify(String(raw))}`,
    );
  }
  const protocol = match[1].toLowerCase();
  const host = match[2].toLowerCase().replace(/\.$/, "");
  const port = match[3];
  return { origin: `${protocol}://${host}${port ? `:${port}` : ""}`, protocol, host, port };
}

/** A comma-separated list of extra hosts, lower-cased, blanks dropped. */
function hostList(value) {
  return String(value || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

/** True for a production domain, any subdomain of one, or an extra host (exact or subdomain). */
export function isProductionHost(host, extraHosts = "") {
  const h = String(host).toLowerCase().replace(/\.$/, "");
  return [...PRODUCTION_DOMAINS, ...hostList(extraHosts)].some((d) => h === d || h.endsWith(`.${d}`));
}

/** True for this machine (a local `next start` / `next dev`). */
export function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

/**
 * The run's target, or an Error (thrown) that stops k6 before any request.
 *
 * `scenario`: the scenario's name (for messages). `readOnlyCapable`: whether
 * the scenario can run with GET/HEAD only (browse and soak can; the on-sale,
 * door and rate-limit scenarios write, or deliberately trip limits, so can't).
 */
export function resolveTarget(env, { scenario, readOnlyCapable }) {
  const { origin, host, protocol } = parseBaseUrl(env.BASE_URL || DEFAULT_BASE_URL);
  const production = isProductionHost(host, env.PRODUCTION_HOSTS);
  if (production) {
    if (!readOnlyCapable) {
      throw new Error(
        `Refusing to run the "${scenario}" scenario against ${host}: it writes data or trips rate limits, and that host is production. ` +
          "Point BASE_URL at the staging Preview deployment (tests/load/README.md).",
      );
    }
    if (env.ALLOW_PRODUCTION !== "1") {
      throw new Error(
        `Refusing to run against ${host}: that host is production. Point BASE_URL at the staging Preview deployment, ` +
          "or, for a read-only run you have decided to make against production, set ALLOW_PRODUCTION=1.",
      );
    }
  }
  if (protocol === "http" && !isLocalHost(host)) {
    throw new Error(`BASE_URL uses plain http for a remote host (${host}). Use https.`);
  }
  return {
    baseUrl: origin,
    host,
    production,
    local: isLocalHost(host),
    // Production is always read-only. Elsewhere READ_ONLY=1 asks for it (browse/soak: no view beacons).
    readOnly: production || env.READ_ONLY === "1",
  };
}

/**
 * Throws if a request would break the rules: a forbidden path, or a write in
 * a read-only run. Every request in the suite goes through this
 * (lib/http.js), so a scenario can't get round it by mistake.
 */
export function assertRequestAllowed(method, path, { readOnly }) {
  const m = String(method).toUpperCase();
  const p = String(path);
  if (!p.startsWith("/")) throw new Error(`Request paths must start with "/" (got ${JSON.stringify(p)}).`);
  if (FORBIDDEN_PATHS.some((re) => re.test(p))) {
    throw new Error(`The load tests never request ${p.split("?")[0]} (Stripe webhook and cron routes are off limits).`);
  }
  if (readOnly && m !== "GET" && m !== "HEAD") {
    throw new Error(`Read-only run: refusing ${m} ${p.split("?")[0]}.`);
  }
}
