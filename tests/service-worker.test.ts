import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Runs the real public/sw.js in a sandbox with fake `caches` and `fetch`, and
 * checks what it does and doesn't intercept and store. It proves the
 * worker's own rules, not browser behaviour (e2e/pwa.spec.ts covers a real
 * Chromium; nothing here covers Safari).
 */

const SW_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");
const ORIGIN = "https://app.sheltuh.com.au";

/* ------------------------------------------------------------------ fakes */

/** Node's Response reports type "default"; the browser reports "basic" for same-origin. */
function withType(response: Response, type: ResponseType): Response {
  const clone = Response.prototype.clone.bind(response);
  Object.defineProperty(response, "type", { value: type, configurable: true });
  Object.defineProperty(response, "clone", { value: () => withType(clone(), type), configurable: true });
  return response;
}

/** In a browser worker, relative URLs resolve against the worker's location. */
class WorkerRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === "string" ? new URL(input, ORIGIN) : input, init);
  }
}

function sameOriginResponse(body = "ok", init: ResponseInit = {}): Response {
  return withType(new Response(body, { status: 200, ...init }), "basic");
}

type RequestLike = { url: string; method: string; mode: string; destination: string; headers: Headers };

function req(
  pathOrUrl: string,
  options: { method?: string; mode?: string; destination?: string; headers?: Record<string, string> } = {},
): RequestLike {
  return {
    url: new URL(pathOrUrl, ORIGIN).href,
    method: options.method ?? "GET",
    mode: options.mode ?? "cors",
    destination: options.destination ?? "",
    headers: new Headers(options.headers ?? {}),
  };
}
const navigate = (p: string) => req(p, { mode: "navigate", destination: "document" });
const image = (p: string) => req(p, { mode: "no-cors", destination: "image" });
const script = (p: string) => req(p, { mode: "cors", destination: "script" });

const keyOf = (request: RequestLike | Request | string) =>
  typeof request === "string" ? new URL(request, ORIGIN).href : request.url;

class FakeCache {
  entries = new Map<string, Response>();
  async match(request: RequestLike | string) {
    return this.entries.get(keyOf(request))?.clone();
  }
  async put(request: RequestLike | string, response: Response) {
    const key = keyOf(request);
    // Like the real Cache API: a re-put moves the entry to the end.
    this.entries.delete(key);
    this.entries.set(key, withType(response, "basic"));
  }
  async addAll(requests: (Request | string)[]) {
    for (const request of requests) {
      const url = keyOf(request);
      this.entries.set(url, sameOriginResponse(`precached ${new URL(url).pathname}`));
    }
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: RequestLike | string) {
    return this.entries.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name) as FakeCache;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  /** Every URL stored in any cache. */
  allUrls() {
    return [...this.stores.values()].flatMap((cache) => [...cache.entries.keys()]);
  }
}

type Handler = (event: unknown) => void;

function loadWorker(fetchImpl: (request: RequestLike) => Promise<Response> = async () => sameOriginResponse()) {
  const listeners: Record<string, Handler> = {};
  const caches = new FakeCacheStorage();
  const fetch = vi.fn(fetchImpl);
  const self = {
    location: new URL("/sw.js", ORIGIN),
    addEventListener: (type: string, handler: Handler) => {
      listeners[type] = handler;
    },
  };
  const context = vm.createContext({ self, caches, fetch, Request: WorkerRequest, Response, Headers, URL });
  vm.runInContext(SW_SOURCE, context, { filename: "public/sw.js" });
  const constant = <T>(name: string) => vm.runInContext(name, context) as T;

  function dispatchFetch(request: RequestLike) {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({
      request,
      respondWith: (response: Promise<Response>) => {
        responded = Promise.resolve(response);
      },
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
    });
    return { responded, settle: () => Promise.all(waits) };
  }

  async function dispatchLifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = [];
    listeners[type]({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  }

  return {
    caches,
    fetch,
    routeFor: (request: RequestLike) => constant<(r: RequestLike, o: string) => string>("routeFor")(request, ORIGIN),
    constant,
    dispatchFetch,
    dispatchLifecycle,
  };
}

/* ------------------------------------------------------------------ routing */

describe("sw.js routing: never intercepted", () => {
  const worker = loadWorker();

  it.each([
    ["an API read", req("/api/events?cursor=10")],
    ["an API navigation", navigate("/api/orders/by-session/cs_test_123")],
    ["the bare /api path", req("/api")],
    ["an API path that looks like an image", image("/api/events/e1/image.png")],
    ["the orders (ticket codes) API", req("/api/orders/by-session/cs_test_123", { headers: { authorization: "Bearer x" } })],
    ["the messages API", req("/api/conversations/abc/messages")],
    ["the checkout API (POST)", req("/api/events/e1/checkout", { method: "POST" })],
    ["the Stripe webhook", req("/api/stripe/webhook", { method: "POST" })],
    ["a non-GET page request", req("/events/x", { method: "POST", mode: "navigate" })],
    ["Supabase auth (cross-origin)", req("https://abcd.supabase.co/auth/v1/token?grant_type=password", { method: "POST" })],
    ["Supabase REST (cross-origin)", req("https://abcd.supabase.co/rest/v1/events")],
    ["a Supabase storage image (cross-origin)", image("https://abcd.supabase.co/storage/v1/object/public/events/a.jpg")],
    ["a Supabase path proxied on this origin", image("/storage/v1/object/public/events/a.jpg")],
    ["Supabase auth proxied on this origin", req("/auth/v1/user")],
    ["the e2e Supabase mock", req("/supabase-mock/auth/v1/user")],
    ["Stripe Checkout (cross-origin navigation)", navigate("https://checkout.stripe.com/c/pay/cs_test_123")],
    ["Stripe.js", script("https://js.stripe.com/v3/")],
    ["an Esri map tile", image("https://server.arcgisonline.com/ArcGIS/rest/services/tile/1/2/3")],
    ["the Next image proxy", image("/_next/image?url=https%3A%2F%2Fabcd.supabase.co%2Fa.jpg&w=640&q=75")],
    ["an RSC fetch (query)", req("/events/x?_rsc=abc12")],
    ["an RSC fetch (header)", req("/messages/abc", { headers: { rsc: "1" } })],
    [
      "a static asset with credentials",
      req("/_next/static/chunks/a.js", { destination: "script", headers: { authorization: "Bearer x" } }),
    ],
    ["a range request", req("/_next/static/media/a.woff2", { headers: { range: "bytes=0-10" } })],
    ["the service worker itself", req("/sw.js")],
    ["the manifest", req("/manifest.webmanifest")],
    ["a page fetched with fetch() (not a navigation)", req("/account")],
    ["an event page whose slug looks like an image, fetched as data", req("/events/poster.png")],
  ])("%s", (_label, request) => {
    expect(worker.routeFor(request)).toBe("bypass");
  });

  it("calls neither respondWith nor fetch for /api, so the browser handles it untouched", () => {
    const fresh = loadWorker();
    const { responded } = fresh.dispatchFetch(req("/api/conversations"));
    expect(responded).toBeUndefined();
    expect(fresh.fetch).not.toHaveBeenCalled();
  });
});

describe("sw.js routing: handled", () => {
  const worker = loadWorker();

  it.each(["/", "/events/rooftop-jazz", "/messages/abc", "/checkout/success?session_id=cs_test_1", "/account", "/admin"])(
    "navigation to %s is network-first with the offline fallback",
    (p) => {
      expect(worker.routeFor(navigate(p))).toBe("navigate");
    },
  );

  it.each([
    script("/_next/static/chunks/app/page-0123abcd.js"),
    req("/_next/static/css/0123abcd.css", { destination: "style" }),
    req("/_next/static/media/bricolage-0123abcd.woff2", { destination: "font" }),
  ])("hashed build output $url is cached first", (request) => {
    expect(worker.routeFor(request)).toBe("static");
  });

  it.each(["/icons/icon-192.png", "/events/jazz-drummer.webp", "/apple-icon.png", "/icon.svg", "/favicon.ico"])(
    "same-origin public image %s is stale-while-revalidate",
    (p) => {
      expect(worker.routeFor(image(p))).toBe("image");
    },
  );
});

/* ------------------------------------------------------------- lifecycle */

describe("sw.js lifecycle", () => {
  it("precaches only the offline page", async () => {
    const worker = loadWorker();
    await worker.dispatchLifecycle("install");
    expect(await worker.caches.keys()).toEqual([worker.constant<string>("SHELL_CACHE")]);
    expect(worker.caches.allUrls()).toEqual([`${ORIGIN}/offline.html`]);
  });

  it("deletes old Sheltüh caches on activate and leaves current and unrelated ones", async () => {
    const worker = loadWorker();
    const current = worker.constant<string[]>("CURRENT_CACHES");
    for (const name of [...current, "sheltuh-static-v0", "sheltuh-pages-old", "someone-else"]) {
      await worker.caches.open(name);
    }
    await worker.dispatchLifecycle("activate");
    expect((await worker.caches.keys()).sort()).toEqual([...current, "someone-else"].sort());
  });

  it("never takes over open pages or skips waiting (no surprise reloads)", () => {
    // Code only: the header comment names these calls to say they aren't used.
    const code = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toContain("addEventListener"); // the stripping left the code intact
    expect(code).not.toMatch(/skipWaiting\s*\(/);
    expect(code).not.toMatch(/clients\.claim\s*\(/);
    expect(code).not.toMatch(/\.navigate\s*\(|location\.reload/);
  });
});

/* ------------------------------------------------------------- navigations */

describe("sw.js navigations", () => {
  it("returns the network page and stores nothing", async () => {
    const page = sameOriginResponse("<h1>Your account</h1>", { headers: { "content-type": "text/html" } });
    const worker = loadWorker(async () => page);
    await worker.dispatchLifecycle("install");
    const { responded } = worker.dispatchFetch(navigate("/account"));
    expect(await responded).toBe(page);
    expect(worker.caches.allUrls()).toEqual([`${ORIGIN}/offline.html`]);
  });

  it("falls back to the precached offline page when the network fails", async () => {
    const worker = loadWorker(async () => {
      throw new TypeError("Failed to fetch");
    });
    await worker.dispatchLifecycle("install");
    const { responded } = worker.dispatchFetch(navigate("/messages/abc"));
    expect(await (await responded)?.text()).toBe("precached /offline.html");
  });

  it("lets the browser's own error through if the offline page was never cached", async () => {
    const worker = loadWorker(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { responded } = worker.dispatchFetch(navigate("/"));
    await expect(responded).rejects.toThrow("Failed to fetch");
  });
});

/* ------------------------------------------------------------- static assets */

describe("sw.js static assets", () => {
  const asset = "/_next/static/chunks/app-0123abcd.js";

  it("stores a hashed asset once and then serves it from the cache", async () => {
    const worker = loadWorker(async () => sameOriginResponse("console.log(1)"));
    const first = worker.dispatchFetch(script(asset));
    expect(await (await first.responded)?.text()).toBe("console.log(1)");
    const second = worker.dispatchFetch(script(asset));
    expect(await (await second.responded)?.text()).toBe("console.log(1)");
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.caches.allUrls()).toEqual([`${ORIGIN}${asset}`]);
  });

  it.each([
    ["Cache-Control: no-store", () => sameOriginResponse("x", { headers: { "cache-control": "no-store" } })],
    ["Cache-Control: private", () => sameOriginResponse("x", { headers: { "cache-control": "private, max-age=60" } })],
    ["a 404", () => sameOriginResponse("missing", { status: 404 })],
    ["a partial response", () => sameOriginResponse("x", { status: 206 })],
    ["an opaque response", () => withType(new Response("x"), "opaque")],
    ["a CORS response", () => withType(new Response("x"), "cors")],
  ])("doesn't store %s", async (_label, makeResponse) => {
    const worker = loadWorker(async () => makeResponse());
    const { responded } = worker.dispatchFetch(script(asset));
    await responded;
    expect(worker.caches.allUrls()).toEqual([]);
  });

  it("refetches an entry older than its age limit, and serves the old copy if offline", async () => {
    const day = 24 * 60 * 60 * 1000;
    let online = true;
    const worker = loadWorker(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return sameOriginResponse("new");
    });
    const cache = await worker.caches.open(worker.constant<string>("STATIC_CACHE"));
    const old = sameOriginResponse("old", { headers: { "x-sw-cached-at": String(Date.now() - 31 * day) } });
    await cache.put(script(asset), old);

    const refreshed = worker.dispatchFetch(script(asset));
    expect(await (await refreshed.responded)?.text()).toBe("new");
    expect(worker.fetch).toHaveBeenCalledTimes(1);

    const stale = sameOriginResponse("old", { headers: { "x-sw-cached-at": String(Date.now() - 31 * day) } });
    await cache.put(script(asset), stale);
    online = false;
    const offline = worker.dispatchFetch(script(asset));
    expect(await (await offline.responded)?.text()).toBe("old");
  });

  it("keeps at most 150 static entries, dropping the oldest", async () => {
    const worker = loadWorker(async (request) => sameOriginResponse(request.url));
    for (let i = 0; i < 155; i += 1) {
      const { responded } = worker.dispatchFetch(script(`/_next/static/chunks/c${i}.js`));
      await responded;
    }
    const urls = worker.caches.allUrls();
    expect(urls).toHaveLength(150);
    expect(urls).not.toContain(`${ORIGIN}/_next/static/chunks/c0.js`);
    expect(urls).toContain(`${ORIGIN}/_next/static/chunks/c154.js`);
  });
});

describe("sw.js images", () => {
  it("serves a fresh cached image at once and refreshes it in the background", async () => {
    const worker = loadWorker(async () => sameOriginResponse("new-bytes"));
    const cache = await worker.caches.open(worker.constant<string>("IMAGE_CACHE"));
    await cache.put(
      image("/icons/icon-192.png"),
      sameOriginResponse("old-bytes", { headers: { "x-sw-cached-at": String(Date.now()) } }),
    );
    const { responded, settle } = worker.dispatchFetch(image("/icons/icon-192.png"));
    expect(await (await responded)?.text()).toBe("old-bytes");
    await settle();
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(await (await cache.match(image("/icons/icon-192.png")))?.text()).toBe("new-bytes");
  });

  it("keeps at most 60 images", async () => {
    const worker = loadWorker(async () => sameOriginResponse("img"));
    for (let i = 0; i < 65; i += 1) {
      const { responded } = worker.dispatchFetch(image(`/events/p${i}.jpg`));
      await responded;
    }
    expect(worker.caches.allUrls()).toHaveLength(60);
  });
});
