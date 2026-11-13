// Every request in the suite goes through this client: it applies the target
// rules (lib/target.js), tags each request with its route group (`rg`) and a
// low-cardinality `name`, declares which statuses are expected (so an expected
// 404, 409 or 429 isn't an http_req_failed), and counts 429s, 5xx and CDN
// cache results separately.
import http from "k6/http";
import { check } from "k6";
import crypto from "k6/crypto";
import { Counter } from "k6/metrics";
import { assertRequestAllowed } from "./target.js";

/** Every 429, tagged by route group: rate limits doing their job, not failures. */
export const rateLimited = new Counter("rate_limited_429");
/** Every 5xx and every request that got no response at all (status 0: timeout, connection error). */
export const serverErrors = new Counter("server_errors_5xx");
/** Vercel's x-vercel-cache per response (HIT, MISS, STALE, …), tagged `cache` and `rg`. */
export const cdnCache = new Counter("cdn_cache");

const USER_AGENT = "Sheltuh-LoadTest/1.0 (k6; +tests/load/README.md)";

const callbacks = {};
/** One response callback per set of expected statuses (made once, reused). */
function expectedStatuses(statuses) {
  const key = statuses.join(",");
  if (!callbacks[key]) callbacks[key] = http.expectedStatuses(...statuses);
  return callbacks[key];
}
// The sets the scenarios use, made here in the init context.
[[200], [204], [200, 401], [200, 404], [200, 429], [404, 429], [200, 401, 403, 404], [201, 409, 429], [200, 409, 429]].forEach(
  expectedStatuses,
);

/** `bytes` random bytes as hex. */
export function randomHex(bytes) {
  const buf = new Uint8Array(crypto.randomBytes(bytes));
  let out = "";
  for (let i = 0; i < buf.length; i++) out += (buf[i] < 16 ? "0" : "") + buf[i].toString(16);
  return out;
}

/** A random (version 4) UUID: what the API asks for as an Idempotency-Key or a check-in requestId. */
export function uuidv4() {
  const b = new Uint8Array(crypto.randomBytes(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let hex = "";
  for (let i = 0; i < 16; i++) hex += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The response's JSON body, or null when it isn't JSON. */
export function jsonBody(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

/** A response header, whatever its case (k6 canonicalises names, e.g. X-Vercel-Cache). */
export function header(res, name) {
  const want = name.toLowerCase();
  for (const key in res.headers) {
    if (key.toLowerCase() === want) return res.headers[key];
  }
  return undefined;
}

/**
 * A same-origin path from a URL the API handed out (imageUrl, logoUrl): as is
 * when it's a path, the path when it's on the target's origin, else null (the
 * suite never requests another host).
 */
export function sameOriginPath(url, baseUrl) {
  if (typeof url !== "string" || url === "") return null;
  if (url.startsWith("/")) return url;
  if (url.startsWith(`${baseUrl}/`)) return url.slice(baseUrl.length);
  return null;
}

/**
 * The client for `target` (lib/target.js resolveTarget). `env` supplies
 * VERCEL_BYPASS_SECRET (Vercel Deployment Protection's "Protection Bypass for
 * Automation" secret, sent as a header on every request; never logged) and
 * CACHE_BUST=1 (adds a random `_lt` query parameter to responses the CDN
 * would share, so the run measures the functions and the database rather than
 * Vercel's CDN; the API ignores unknown parameters).
 */
export function createClient(target, env) {
  const baseHeaders = { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9, */*;q=0.8" };
  if (env.VERCEL_BYPASS_SECRET) baseHeaders["x-vercel-protection-bypass"] = env.VERCEL_BYPASS_SECRET;
  const bust = env.CACHE_BUST === "1";

  /**
   * One request's k6 arguments. `spec`:
   * - rg: route group (thresholds and per-group metrics), name: the request's
   *   low-cardinality name (a route pattern, never an id);
   * - expect: the statuses that are a correct answer (default [200]);
   * - token: a Supabase access token for `Authorization: Bearer`;
   * - json: a body to send as JSON; headers: extra headers;
   * - cacheable: a response the CDN shares (CACHE_BUST applies);
   * - discardBody: don't keep the body (images); timeout: k6 duration string.
   */
  function prepare(method, path, spec) {
    assertRequestAllowed(method, path, target);
    let finalPath = path;
    if (bust && spec.cacheable) finalPath += `${path.indexOf("?") === -1 ? "?" : "&"}_lt=${randomHex(6)}`;
    const headers = Object.assign({}, baseHeaders, spec.headers || {});
    let body = null;
    if (spec.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(spec.json);
    }
    if (spec.token) headers.Authorization = `Bearer ${spec.token}`;
    const expect = spec.expect || [200];
    const params = {
      headers,
      tags: { rg: spec.rg, name: spec.name },
      responseCallback: expectedStatuses(expect),
      timeout: spec.timeout || "30s",
      redirects: spec.redirects === undefined ? 5 : spec.redirects,
    };
    if (spec.discardBody) params.responseType = "none";
    return { method, url: `${target.baseUrl}${finalPath}`, body, params, expect };
  }

  function record(res, spec, expect) {
    const tags = { rg: spec.rg };
    if (res.status === 429) rateLimited.add(1, tags);
    if (res.status === 0 || res.status >= 500) serverErrors.add(1, { rg: spec.rg, status: String(res.status) });
    const cache = header(res, "x-vercel-cache");
    if (cache) cdnCache.add(1, { rg: spec.rg, cache: String(cache).toUpperCase() });
    const checks = {};
    checks[`${spec.rg}: expected status`] = (r) => expect.indexOf(r.status) !== -1;
    check(res, checks, { rg: spec.rg });
    return res;
  }

  function request(method, path, spec) {
    const p = prepare(method, path, spec);
    const res = http.request(p.method, p.url, p.body, p.params);
    return record(res, spec, p.expect);
  }

  /** Several requests at once, as a browser does after the HTML: `[{method, path, spec}]`. */
  function batch(items) {
    const prepared = items.map((it) => prepare(it.method || "GET", it.path, it.spec));
    const responses = http.batch(prepared.map((p) => ({ method: p.method, url: p.url, body: p.body, params: p.params })));
    return responses.map((res, i) => record(res, items[i].spec, prepared[i].expect));
  }

  return {
    target,
    get: (path, spec) => request("GET", path, spec),
    post: (path, spec) => request("POST", path, spec),
    batch,
  };
}
