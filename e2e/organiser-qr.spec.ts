import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * An event's QR code (/dashboard/events/[id]/qr) and its printable sign
 * (…/qr/sign; docs/architecture.md, "Event QR codes"): reached from the
 * Events tab's card menu, the "QR code" tracking link made on the first
 * visit, the PNG and SVG downloads, the sign on A4 and A5 and how it prints,
 * phones, and the Dark theme. Live mode, signed in with a stored test
 * session, with every /api/* request answered here.
 */

const DAY = 86_400_000;
const EVENT = "evt-qr";
const SLUG = "neon-static-warehouse-night";
const TRACKED = `https://sheltuh.com.au/events/${SLUG}?ref=k7mq2hxd`;

interface Seen {
  /** Each tracking-links request, in order: "GET" or "POST {label}". */
  tracking: string[];
}

function eventRecord(extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    organiserId: "org-demo",
    eventId: EVENT,
    slug: SLUG,
    title: "Neon Static: warehouse night",
    description: "",
    category: "live-music",
    venueName: "Interconnect Studio",
    venueAddress: "12 Sydney Rd",
    suburb: "Brunswick",
    state: "VIC",
    timeZone: "Australia/Melbourne",
    startsAt: "2026-12-12T09:00:00.000Z",
    endsAt: "2026-12-12T13:00:00.000Z",
    organiserName: "Northside Noise",
    ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 120 }],
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: true,
    status: "published",
    moderationLog: [],
    createdAt: new Date(now - 20 * DAY).toISOString(),
    updatedAt: new Date(now - 2 * DAY).toISOString(),
    ...extra,
  };
}

function summary() {
  const now = Date.now();
  return {
    eventId: EVENT,
    title: "Neon Static: warehouse night",
    slug: SLUG,
    stage: "live",
    startsAt: new Date(now + 4 * DAY).toISOString(),
    endsAt: new Date(now + 4 * DAY + 4 * 3_600_000).toISOString(),
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "Interconnect Studio",
    suburb: "Brunswick",
    ticketingMode: "sheltuh",
    free: false,
    ticketsSold: 12,
    capacity: 120,
    grossCents: 36_000,
    netCents: 33_000,
  };
}

async function signedInOrganiser(page: Page, event = eventRecord()): Promise<Seen> {
  const seen: Seen = { tracking: [] };
  const links: unknown[] = [];
  const now = Date.now();
  const session = {
    access_token: "e2e.token.x",
    token_type: "bearer",
    expires_in: 31_536_000,
    expires_at: Math.floor(now / 1000) + 31_536_000,
    refresh_token: "r",
    user: {
      id: "u1",
      aud: "authenticated",
      role: "authenticated",
      email: "mia@example.com",
      email_confirmed_at: new Date(now - 300 * DAY).toISOString(),
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date(now - 300 * DAY).toISOString(),
    },
  };
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/organisers/me") {
      return route.fulfill({
        json: {
          ownerUserId: "u1",
          organiserId: "org-demo",
          displayName: "Northside Noise",
          contactEmail: "hello@northside.example",
          description: "Warehouse nights.",
          categories: ["live-music"],
          status: "approved",
          createdAt: new Date(now - 200 * DAY).toISOString(),
          updatedAt: new Date(now - 2 * DAY).toISOString(),
          payoutsEnabled: true,
        },
      });
    }
    if (path === "/api/organisers/me/events/summary") {
      return route.fulfill({
        json: {
          items: [summary()],
          counts: { all: 1, live: 1, drafts: 0, past: 0, byStage: { live: 1, sold_out: 0, ended: 0, in_review: 0, changes_needed: 0, unpublished: 0, draft: 0 } },
        },
      });
    }
    if (path === `/api/organisers/me/events/${EVENT}`) return route.fulfill({ json: event });
    if (path === `/api/organisers/me/events/${EVENT}/tracking-links`) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { label: string };
        seen.tracking.push(`POST ${body.label}`);
        // As the API: a label already on the event (any case) is a 409 on the label.
        if (links.some((l) => (l as { label: string }).label.toLowerCase() === body.label.toLowerCase())) {
          return route.fulfill({ status: 409, json: { error: "Label taken.", fieldErrors: { label: "You already have a link with this label." } } });
        }
        const link = { linkId: "l1", code: "k7mq2hxd", label: body.label, url: TRACKED, createdAt: new Date().toISOString(), views: 0, orders: 0, ticketsSold: 0, grossCents: 0 };
        links.push(link);
        return route.fulfill({ status: 201, json: link });
      }
      seen.tracking.push("GET");
      return route.fulfill({ json: { items: links } });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  return seen;
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

/** Each page of a PDF Chromium printed, as its MediaBox's width and height in whole points. */
function pdfPages(pdf: Buffer): [number, number][] {
  const text = pdf.toString("latin1");
  const pages = text.match(/\/Type\s*\/Page\b/g) ?? [];
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m): [number, number] => [Math.round(Number(m[1])), Math.round(Number(m[2]))]);
  expect(boxes).toHaveLength(pages.length);
  return boxes;
}

/** Every part of the sheet is inside it (nothing clipped at its foot), and the wordmark comes last. */
async function expectFits(sheet: ReturnType<Page["getByRole"]>) {
  const box = (await sheet.boundingBox())!;
  const parts = await sheet.locator(".qr-sign-body > *").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.getAttribute("class") ?? "", bottom: r.bottom };
    }),
  );
  expect(parts.at(-1)!.cls).toContain("qr-sign-wordmark");
  for (const part of parts) expect(part.bottom, part.cls).toBeLessThanOrEqual(box.y + box.height + 0.5);
}

/** A PNG's width and height, from its IHDR chunk (which must come first, after the signature). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("from the card menu to the code: the tracking link is made once, then the PNG and SVG download", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = await signedInOrganiser(page);
  await page.goto("/dashboard/events");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "More for Neon Static: warehouse night" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "QR code" }).click();
  await expect(page).toHaveURL(`/dashboard/events/${EVENT}/qr`);
  await expect(main.getByRole("heading", { level: 1, name: "QR code" })).toBeVisible();
  const code = main.getByRole("img", { name: `QR code for sheltuh.com.au/events/${SLUG}` });
  await expect(code).toBeVisible();
  // Listed (none yet), then made, labelled "QR code".
  expect(seen.tracking).toEqual(["GET", "POST QR code"]);
  // The dashboard frame: the page sits in Events.
  await expect(page.locator("[data-organiser-sidebar] a[aria-current]")).toHaveText(/Events/);

  const [png] = await Promise.all([page.waitForEvent("download"), main.getByRole("button", { name: "Download PNG" }).click()]);
  expect(png.suggestedFilename()).toBe(`sheltuh-${SLUG}-qr.png`);
  // A version 6 symbol: 41 modules and the 8 of the quiet zones, at 41 px each.
  expect(pngSize(readFileSync(await png.path()))).toEqual({ width: 2009, height: 2009 });

  const [svg] = await Promise.all([page.waitForEvent("download"), main.getByRole("button", { name: "Download SVG" }).click()]);
  expect(svg.suggestedFilename()).toBe(`sheltuh-${SLUG}-qr.svg`);
  const file = readFileSync(await svg.path(), "utf8");
  expect(file).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 49 49"/);
  expect(file).not.toContain(SLUG);

  // A second visit reuses the link: nothing more is made.
  await page.reload();
  await expect(code).toBeVisible();
  expect(seen.tracking).toEqual(["GET", "POST QR code", "GET"]);
});

test("the printable sign: A4 and A5 previews, and printing shows the sheet alone at the paper's size", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await signedInOrganiser(page);
  await page.goto(`/dashboard/events/${EVENT}/qr`);
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Printable sign" }).click();
  await expect(page).toHaveURL(`/dashboard/events/${EVENT}/qr/sign`);
  const sheet = main.getByRole("region", { name: "Sign preview, A4" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Neon Static: warehouse night");
  await expect(sheet.getByText("Sat 12 Dec, 8:00 pm – Sun 13 Dec, midnight")).toBeVisible();
  await expect(sheet.getByText("Interconnect Studio, Brunswick, VIC")).toBeVisible();
  await expect(sheet.getByText("Scan for tickets")).toBeVisible();
  await expect(sheet.getByText(`sheltuh.com.au/events/${SLUG}`)).toBeVisible();
  // Every part fits on the sheet: the wordmark, last, isn't cut off at its foot.
  await expectFits(sheet);

  await main.getByRole("button", { name: "Print or save as PDF" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // Printing: the sheet is the page (210mm wide), and the header, footer, sidebar and controls are gone.
  await page.emulateMedia({ media: "print" });
  const mm = 96 / 25.4;
  const printed = await sheet.boundingBox();
  expect(Math.abs(printed!.width - 210 * mm)).toBeLessThan(1);
  expect(printed!.x).toBeLessThan(1);
  for (const hidden of [page.getByRole("banner"), page.getByRole("contentinfo"), main.getByRole("heading", { level: 1 }), main.getByRole("group", { name: "Paper size" })]) {
    await expect(hidden.first()).toBeHidden();
  }
  await expect(page.locator("[data-organiser-sidebar]")).toBeHidden();
  // One page, A4 (595 × 842 pt): the page's own size (SIGN_PAGE_CSS), not the PDF's default.
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toEqual([[595, 842]]);

  await page.emulateMedia({ media: "screen" });
  await main.getByRole("radio", { name: "A5" }).check();
  const a5 = main.getByRole("region", { name: "Sign preview, A5" });
  await expect(a5).toBeVisible();
  await page.emulateMedia({ media: "print" });
  expect(Math.abs((await a5.boundingBox())!.width - 148 * mm)).toBeLessThan(1);
  // One page, A5 (420 × 595 pt).
  expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }))).toEqual([[420, 595]]);
});

test("an unpublished event has no code, and no tracking link is made", async ({ page }) => {
  const seen = await signedInOrganiser(page, eventRecord({ status: "draft", ticketingLocked: false }));
  await page.goto(`/dashboard/events/${EVENT}/qr`);
  await expect(page.getByText("Publish your event first")).toBeVisible();
  expect(seen.tracking).toEqual([]);
});

test("on a 375px phone: no sideways scroll, targets at least 44px, the code and the sign fit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedInOrganiser(page);
  await page.goto(`/dashboard/events/${EVENT}/qr`);
  const main = page.getByRole("main");
  await expect(main.getByRole("img", { name: /QR code for/ })).toBeVisible();
  await noSidewaysScroll(page);
  for (const name of ["Download PNG", "Download SVG"]) {
    expect((await main.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect((await main.getByRole("link", { name: "Printable sign" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const backLinks = main.getByRole("navigation", { name: "Event" }).getByRole("link");
  for (const link of await backLinks.all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await page.goto(`/dashboard/events/${EVENT}/qr/sign`);
  const sheet = main.getByRole("region", { name: "Sign preview, A4" });
  await expect(sheet).toBeVisible();
  await noSidewaysScroll(page);
  expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(375);
  for (const name of ["A4", "A5"]) {
    const label = main.locator("label").filter({ has: page.getByRole("radio", { name }) });
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect((await main.getByRole("button", { name: "Print or save as PDF" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("in the Dark theme the code's plate and the sign stay white with black ink", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sheltuh:theme", "dark"));
  await signedInOrganiser(page);
  await page.goto(`/dashboard/events/${EVENT}/qr`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const code = page.getByRole("main").getByRole("img", { name: /QR code for/ });
  await expect(code).toBeVisible();
  expect(await code.locator("rect").getAttribute("fill")).toBe("#ffffff");
  expect(await code.locator("path").getAttribute("fill")).toBe("#000000");
  expect(await code.evaluate((el) => getComputedStyle(el).colorScheme)).toBe("light only");

  await page.goto(`/dashboard/events/${EVENT}/qr/sign`);
  const sheet = page.getByRole("main").getByRole("region", { name: "Sign preview, A4" });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await sheet.getByRole("heading", { level: 2 }).evaluate((el) => getComputedStyle(el).color)).toBe("rgb(0, 0, 0)");
});
