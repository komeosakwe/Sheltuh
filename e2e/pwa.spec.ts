import { expect, test, type Page } from "@playwright/test";

/**
 * The installable-web-app layer (docs/pwa.md) in a real Chromium, on the
 * local `next dev` server, at desktop and 375px ("phone-375" project).
 *
 * What this does NOT prove: anything about Safari/iOS, a real device, real
 * install UI, or the production registration path (the app only registers
 * the worker in a production build on HTTPS, so these tests register
 * /sw.js by hand; 127.0.0.1 counts as a secure context). /api is
 * intercepted, so nothing reaches a backend.
 */

async function stubApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "not mocked in e2e" } }));
}

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test("the page links a valid manifest, icons and iOS metadata", async ({ page, request }) => {
  await page.goto("/help");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f3f0e8");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Sheltüh");
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(appleIcon).toMatch(/^\/apple-icon\.png/);

  const res = await request.get(manifestHref ?? "");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Sheltüh", start_url: "/", scope: "/", display: "standalone" });

  for (const src of [...manifest.icons.map((icon: { src: string }) => icon.src), appleIcon ?? ""]) {
    const icon = await request.get(src);
    expect(icon.ok(), src).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/png");
  }
});

test("the offline page renders on its own, without scrolling sideways", async ({ page }) => {
  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { level: 1, name: "You’re offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs a connection" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the service worker caches static assets and the offline page, and never /api or pages", async ({ page, context }) => {
  await page.goto("/help");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  // A reload puts the page under the worker's control (it never claims open pages itself).
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async () => {
    // An API read and a credentialed one, an image, and another page fetch.
    await fetch("/api/events?e2e=1").catch(() => undefined);
    await fetch("/api/orders/by-session/cs_test_e2e", { headers: { authorization: "Bearer e2e" } }).catch(() => undefined);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = "/icons/icon-192.png";
    });
  });

  const cached = await page.evaluate(async () => {
    const all: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) all.push(`${name} ${new URL(req.url).pathname}`);
    }
    return all;
  });

  expect(cached).toContain("sheltuh-shell-v1 /offline.html");
  expect(cached.some((entry) => entry.startsWith("sheltuh-static-v1 /_next/static/"))).toBe(true);
  expect(cached).toContain("sheltuh-images-v1 /icons/icon-192.png");
  expect(cached.filter((entry) => entry.includes("/api"))).toEqual([]);
  // No page HTML: the only non-asset entry is the offline page.
  expect(cached.filter((entry) => !/\/_next\/static\/|\/icons\/|\.(png|svg|ico|jpe?g|webp)$|\/offline\.html$/.test(entry))).toEqual(
    [],
  );

  // Offline, a navigation gets the offline page instead of the browser's error.
  await context.setOffline(true);
  try {
    await page.goto("/events/some-event");
    await expect(page.getByRole("heading", { level: 1, name: "You’re offline" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("Chrome's install offer appears in the footer on a browsing page, and No thanks sticks", async ({ page }) => {
  await page.goto("/help");
  // Fire Chrome's event until the hydrated footer handles it (it prevents the default).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => undefined,
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
        });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    )
    .toBe(true);

  const offer = page.getByRole("group", { name: "Get Sheltüh on your home screen" });
  await expect(offer).toBeVisible();
  for (const name of ["Install", "No thanks"]) {
    const box = await offer.getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await offer.getByRole("button", { name: "No thanks" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "won’t suggest this again" })).toBeFocused();

  await page.reload();
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole("group", { name: "Get Sheltüh on your home screen" })).toHaveCount(0);
});
