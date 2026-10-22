import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The event page in a real browser (docs/design/brand-direction-one.md §6.10,
 * docs/architecture.md "External ticketing"). The e2e server runs in live
 * mode with every /api/* request intercepted here, so the events are the demo
 * samples served as the live API would: the Humanitix sample (paid, external),
 * Footscray Open Studios (free, the organiser's own site) and Neon Static
 * (Sheltüh-ticketed). The ticketing sites themselves are never reached.
 */

const DAY = 86_400_000;

function asPublic(slug: string): PublicEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  const start = Date.now() + 7 * DAY;
  return {
    organiserId: "org-demo",
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 4 * 3600_000).toISOString(),
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    ticketingMode: event.ticketingMode ?? "sheltuh",
    externalTicketUrl: event.externalTicketUrl,
    externalFree: event.externalFree ?? false,
    externalProvider: event.externalProvider ?? null,
  };
}

/** Mocks the API; returns the outbound-click beacons seen, and every Who's Going request. */
async function mockApi(page: Page) {
  const outbound: string[] = [];
  const going: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const slug = /^\/api\/events\/slug\/([^/]+)$/.exec(url.pathname)?.[1];
    if (slug) {
      try {
        return route.fulfill({ json: asPublic(decodeURIComponent(slug)) });
      } catch {
        return route.fulfill({ status: 404, json: { error: "Event not found." } });
      }
    }
    if (/\/outbound$/.test(url.pathname) && request.method() === "POST") {
      outbound.push(url.pathname);
      return route.fulfill({ status: 204 });
    }
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    if (/\/going(\/|$)/.test(url.pathname)) {
      going.push(url.pathname);
      return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    }
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
  // The ticketing sites: a stub page, never the real site.
  await page.context().route(/^https:\/\/(events\.humanitix\.com|www\.example\.com)\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Ticketing site</title><p>stub</p>" }),
  );
  return { outbound, going };
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("external event (Humanitix) at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("links out from the tickets section with the click beacon; no price, selector or Who's Going", async ({ page }) => {
    const { outbound, going } = await mockApi(page);
    await page.goto("/events/thornbury-dub-session");
    const tickets = page.locator("#tickets");
    const link = tickets.getByRole("link", { name: "Get tickets on Humanitix (opens in a new tab)" });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", "https://events.humanitix.com/thornbury-dub-session-demo");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(tickets).toContainText("sold and priced by Humanitix, not Sheltüh");
    await expect(tickets).not.toContainText("Tickets coming soon");
    await expect(tickets).not.toContainText("A$");
    await expect(page.getByRole("heading", { name: /who.s going/i })).toHaveCount(0);

    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await expect(popup).toHaveURL("https://events.humanitix.com/thornbury-dub-session-demo");
    await expect.poll(() => outbound).toEqual(["/api/events/evt-thornbury-dub-session/outbound"]);
    // The opener isn't exposed to the other site.
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(going).toEqual([]);
    await noSidewaysScroll(page);
  });
});

test.describe("external event (free, organiser's site) at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the buy bar says where tickets are and is the outbound link itself", async ({ page }) => {
    const { outbound } = await mockApi(page);
    await page.goto("/events/footscray-open-studios");
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText("Free");
    await expect(bar).toContainText("Tickets on the organiser's site");
    const cta = bar.getByRole("link", { name: "Get tickets on the organiser's site (opens in a new tab)" });
    await expect(cta).toHaveAttribute("href", "https://www.example.com/footscray-open-studios/rsvp");
    await expect(page.locator("#tickets")).not.toContainText("Tickets coming soon");
    const [popup] = await Promise.all([page.waitForEvent("popup"), cta.click()]);
    await popup.close();
    await expect.poll(() => outbound.length).toBe(1);
    await noSidewaysScroll(page);
  });
});

test.describe("Sheltüh-ticketed event at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("buy bar Buy tickets focuses the tickets, whose totals include the fee and come first", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toContainText("From A$31.70", { timeout: 30_000 });
    // The tab is titled with the event once it's loaded (live pages render client-side).
    await expect(page).toHaveTitle("Neon Static — Sheltüh");
    await bar.getByRole("link", { name: "Buy tickets" }).click();
    await expect(page).toHaveURL(/#tickets$/);
    await expect(page.locator("#tickets")).toBeFocused();
    const tickets = page.locator("#tickets");
    await expect(tickets.getByText("A$31.70 incl. booking fee")).toBeVisible();
    // The breakdown is there before anything's chosen.
    await expect(tickets.getByText("A$30 ticket + A$1.70 booking fee")).toBeVisible();
    await noSidewaysScroll(page);
  });
});

// Owner request (21 Oct 2026): the event's name, date and venue are on the first screen, above
// the phone's sticky buy bar, without scrolling. The longest sample title is checked too.
for (const vp of [
  { width: 390, height: 844, phone: true },
  { width: 375, height: 667, phone: true },
  { width: 1280, height: 800, phone: false },
]) {
  test.describe(`first screen at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const slug of ["neon-static", "laneway-projections-after-dark"]) {
      test(`${slug}: ${vp.phone ? "the title, date and venue are in view, above the buy bar" : "the title is in view"}`, async ({ page }) => {
        await mockApi(page);
        await page.goto(`/events/${slug}`);
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toBeVisible({ timeout: 30_000 });
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        const bar = page.locator("[data-buy-bar]");
        const barBox = (await bar.isVisible()) ? await bar.boundingBox() : null;
        if (vp.phone) expect(barBox).not.toBeNull();
        // What's visible: from under the sticky header to the top of the buy bar (or the screen's foot).
        const bottom = barBox ? barBox.y : vp.height;

        const box = await h1.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.y ?? 0) + (box?.height ?? Infinity)).toBeLessThanOrEqual(bottom);

        if (vp.phone) {
          // The key facts under the title (the When/Where aside comes much later on phones).
          const facts = h1.locator("xpath=following-sibling::p[1]");
          const factsBox = await facts.boundingBox();
          expect(factsBox).not.toBeNull();
          expect((factsBox?.y ?? 0) + (factsBox?.height ?? Infinity)).toBeLessThanOrEqual(bottom);
        }
      });
    }
  });
}

test.describe("live event page that can't load", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("says so with Try again, which keeps focus and loads the page when it can", async ({ page }) => {
    let fail = true;
    let loads = 0;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) {
        loads += 1;
        return fail
          ? route.fulfill({ status: 503, json: { error: "The service is busy." } })
          : route.fulfill({ json: asPublic("neon-static") });
      }
      if (/\/going(\/|$)/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Couldn’t load this event" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alert").filter({ hasText: "The service is busy." })).toBeVisible();
    await expect(page).toHaveTitle("Couldn’t load event — Sheltüh");
    await expect(page.getByRole("link", { name: "Back to all events" })).toHaveAttribute("href", "/");

    const retry = page.getByRole("button", { name: "Try again" });
    await retry.focus();
    const before = loads;
    await page.keyboard.press("Enter");
    await expect.poll(() => loads).toBe(before + 1);
    await expect(retry).not.toHaveAttribute("aria-disabled", "true");
    // Failed again: still on the button.
    await expect(retry).toBeFocused();
    fail = false;
    await page.keyboard.press("Enter");
    const title = page.getByRole("heading", { level: 1, name: "Neon Static" });
    await expect(title).toBeFocused();
    await expect(page).toHaveTitle("Neon Static — Sheltüh");
  });
});

for (const width of [320, 375]) {
  test.describe(`share popover at ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } });

    test("stays inside the viewport and closes when focus leaves it", async ({ page }) => {
      await mockApi(page);
      // No share sheet, and a clipboard that refuses: the copy-by-hand popover.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: () => Promise.reject(new Error("denied")) },
          configurable: true,
        });
      });
      await page.goto("/events/neon-static");
      const share = page.getByRole("button", { name: "Share Neon Static" });
      await expect(share).toBeVisible({ timeout: 30_000 });
      await share.click();
      const popover = page.getByRole("group", { name: "Copy the link" });
      await expect(popover).toBeVisible();
      await expect(popover.getByRole("textbox", { name: "Link to this event" })).toBeFocused();
      const box = await popover.boundingBox();
      if (!box) throw new Error("popover not laid out");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const shareBox = await share.boundingBox();
      if (!shareBox) throw new Error("share not laid out");
      expect(box.y).toBeGreaterThanOrEqual(shareBox.y + shareBox.height);
      await noSidewaysScroll(page);

      // Field → Close → Copy → out of the popover.
      for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
      await expect(popover).toHaveCount(0);
      await expect(share).not.toBeFocused();
    });
  });
}

// The event page's P1 items (docs/design/mobile-redesign.md §6.4.2, §6.5), at a phone and a desktop width.
for (const width of [375, 1280]) {
  test.describe(`event details at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 812 : 800 } });

    test("directions, the time zone, More from the organiser, Who's Going preview and booking info", async ({ page }) => {
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: asPublic("neon-static") });
        if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 14, countHidden: false, closed: false } });
        return route.fulfill({ status: 204 });
      });
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      const event = sampleEvents.find((e) => e.slug === "neon-static");
      if (!event) throw new Error("no sample");
      const address = `${event.venueName}, ${event.venueAddress}`;

      // Get directions: the address and the action, one link, out to Google Maps in a new tab.
      const directions = page.getByRole("link", { name: `Get directions to ${address} (opens Google Maps in a new tab)` });
      await expect(directions).toHaveAttribute("href", `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
      await expect(directions).toHaveAttribute("target", "_blank");
      await expect(directions).toHaveAttribute("rel", "noopener noreferrer");
      await expect(directions).toContainText(address);

      // The zone in effect at the start (a week out from now: AEST or AEDT).
      await expect(page.getByText(/^Melbourne time \((AEST|AEDT)\)$/)).toBeVisible();

      // The organiser's other events.
      await expect(page.getByRole("link", { name: `More from ${event.organiserName}` })).toHaveAttribute(
        "href",
        "/organisers/org-demo#organiser-upcoming",
      );

      // Who's Going, signed out: the count, no names or faces, and no list to open.
      const going = page.getByRole("region", { name: "Who's going" });
      await expect(going).toContainText("14");
      await expect(going.locator("[data-going-faces]")).toHaveCount(0);
      await expect(going.getByRole("button", { name: "See who’s going" })).toHaveCount(0);

      // Fees and refunds beside the tickets, linking the existing pages.
      const tickets = page.locator("#tickets");
      await expect(tickets.getByText("A$31.70 incl. booking fee")).toBeVisible();
      // (Live, the selector's own "By booking you agree to the Purchase Terms" line links them too:
      // that's consent at checkout; this is where refund conditions are.)
      const refunds = tickets.locator("dl").filter({ hasText: "Refunds" });
      await expect(refunds.getByRole("link", { name: "Request a refund" })).toHaveAttribute("href", "/refunds");
      await expect(refunds.getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");

      await noSidewaysScroll(page);
    });
  });
}

test.describe("ended event at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // A7 (accessibility review, 22 Oct 2026): no buy bar at all once the event has ended.
  test("no buy bar; the tickets panel says it has ended, and Save stays by the title", async ({ page }) => {
    const ended = { ...asPublic("neon-static"), startsAt: new Date(Date.now() - 2 * DAY).toISOString(), endsAt: new Date(Date.now() - 2 * DAY + 4 * 3600_000).toISOString() };
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: ended });
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: true } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    await expect(page.locator("#tickets")).toContainText("This event has ended.", { timeout: 30_000 });
    await expect(page.locator("[data-buy-bar]")).toHaveCount(0);
    // Signed out, Save is a sign-in link; the one by the title stays.
    await expect(page.getByRole("link", { name: "Sign in to save Neon Static" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Sign in to save Neon Static" })).toBeVisible();
    // No refunds row where nothing can be bought (A6).
    await expect(page.locator("#tickets [data-booking-info]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });
});
