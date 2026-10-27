import { expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
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
  // A week out, at a fixed hour (08:00 UTC: 7:00 pm in Melbourne in daylight time), so the date
  // line under the title is the same length whenever the suite runs (a start late in the evening
  // runs past midnight, to a two-line range, and the first-screen checks below would shift).
  const startDay = new Date(Date.now() + 7 * DAY);
  startDay.setUTCHours(8, 0, 0, 0);
  const start = startDay.getTime();
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
    // No Sheltüh refund policy: Humanitix's terms apply.
    await expect(tickets).not.toContainText("change of mind");
    await expect(tickets).not.toContainText("Australian Consumer Law");
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
    await expect(bar).toContainText("From A$32.30", { timeout: 30_000 });
    // The tab is titled with the event once it's loaded (live pages render client-side).
    await expect(page).toHaveTitle("Neon Static — Sheltüh");
    await bar.getByRole("link", { name: "Buy tickets" }).click();
    await expect(page).toHaveURL(/#tickets$/);
    await expect(page.locator("#tickets")).toBeFocused();
    const tickets = page.locator("#tickets");
    await expect(tickets.getByText("A$32.30 incl. booking fee")).toBeVisible();
    // The breakdown is there before anything's chosen.
    await expect(tickets.getByText("A$30 ticket + A$2.30 booking fee")).toBeVisible();
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
          // The one facts block under the title (Refinement, 22 Oct 2026): the date and the venue.
          const facts = page.locator("[data-event-facts]");
          for (const fact of [facts.locator("dd").first().locator("p").first(), facts.locator("[data-directions]").first()]) {
            const factBox = await fact.boundingBox();
            expect(factBox).not.toBeNull();
            expect((factBox?.y ?? 0) + (factBox?.height ?? Infinity)).toBeLessThanOrEqual(bottom);
          }
        }
      });
    }
  });
}

// Owner request (26 Oct 2026): on a phone, Save and Share are on the first screen too, above the
// buy bar, with a two-line title and a two-line address. 390×664 is a 390×844 phone less its
// browser chrome; 375×667 is the small iPhone.
for (const vp of [
  { width: 390, height: 664 },
  { width: 375, height: 667 },
]) {
  test.describe(`Save and Share on the first screen at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("laneway-projections-after-dark: the actions row ends above the buy bar", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/laneway-projections-after-dark");
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // The case it's for: the title and the address each take two lines.
      const lines = (el: HTMLElement) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      expect(await h1.evaluate(lines)).toBe(2);
      const address = page.locator("[data-event-facts] [data-directions]");
      expect(await address.evaluate(lines)).toBe(2);

      const bar = await page.locator("[data-buy-bar]").boundingBox();
      if (!bar) throw new Error("no buy bar");
      const actions = page.locator("[data-event-actions]");
      const save = actions.getByRole("link", { name: "Sign in to save Laneway Projections: After Dark" });
      const share = actions.getByRole("button", { name: "Share Laneway Projections: After Dark" });
      for (const control of [save, share]) {
        const box = await control.boundingBox();
        if (!box) throw new Error("not laid out");
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      }
      // Add to calendar keeps its 44px target, and doesn't overlap the address link below it.
      const calendar = await page.getByRole("button", { name: "Add to calendar" }).boundingBox();
      const addressBox = await address.boundingBox();
      if (!calendar || !addressBox) throw new Error("not laid out");
      expect(calendar.height).toBeGreaterThanOrEqual(44);
      expect(calendar.y + calendar.height).toBeLessThanOrEqual(addressBox.y);
      await noSidewaysScroll(page);
    });
  });
}

test.describe("Report this event at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("an email to support naming the event, at the end of the details, with no sideways scroll", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    const report = page.getByRole("link", { name: "Report this event" });
    await report.scrollIntoViewIfNeeded();
    await expect(report).toBeVisible();
    const href = (await report.getAttribute("href")) ?? "";
    expect(href).toMatch(/^mailto:support@sheltuh\.com\.au\?subject=/);
    expect(decodeURIComponent(href.split("?subject=")[1])).toMatch(/^Report: Neon Static \((https?:\/\/[^/]+)?\/events\/neon-static\)$/);
    expect((await report.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24);
    await noSidewaysScroll(page);
  });
});

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

// Add to calendar (docs/design/brand-direction-one.md §6.7): plain links, the Apple one to the
// event's .ics route on this site (served inline as text/calendar: e2e/demo.spec.ts fetches it).
test.describe("add to calendar at 375px", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("Apple Calendar is a plain link to the .ics route; the menu stays in the viewport", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    const trigger = page.getByRole("button", { name: "Add to calendar" });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator(`#${await trigger.getAttribute("aria-controls")}`);
    await expect(menu.getByRole("link")).toHaveText([
      "Apple Calendar",
      "Google Calendar",
      "Outlook",
      "Download .ics (other apps)",
    ]);
    const apple = menu.getByRole("link", { name: "Apple Calendar" });
    await expect(apple).toHaveAttribute("href", "/events/neon-static/calendar.ics");
    expect(await apple.getAttribute("download")).toBeNull();
    await expect(menu.getByRole("link", { name: "Outlook (opens in a new tab)" })).toHaveAttribute(
      "href",
      /^https:\/\/outlook\.live\.com\/calendar\/0\/action\/compose\?subject=Neon%20Static&startdt=/,
    );
    const box = await menu.boundingBox();
    if (!box) throw new Error("menu not laid out");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await noSidewaysScroll(page);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test.describe("on Android", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    });

    test("Google Calendar comes first", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/neon-static");
      const trigger = page.getByRole("button", { name: "Add to calendar" });
      await expect(trigger).toBeVisible({ timeout: 30_000 });
      await trigger.click();
      const menu = page.locator(`#${await trigger.getAttribute("aria-controls")}`);
      await expect(menu.getByRole("link").first()).toHaveText("Google Calendar");
      await expect(menu.getByRole("link").nth(1)).toHaveAttribute("href", "/events/neon-static/calendar.ics");
    });
  });
});

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

      // The address is the directions link, out to Google Maps in a new tab.
      const directions = page.getByRole("link", { name: `Get directions to ${address} (opens Google Maps in a new tab)` });
      await expect(directions).toHaveAttribute("href", `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
      await expect(directions).toHaveAttribute("target", "_blank");
      await expect(directions).toHaveAttribute("rel", "noopener noreferrer");
      await expect(directions).toContainText(address);

      // The zone in effect at the start (a week out from now: AEST or AEDT).
      await expect(page.getByText(/^Melbourne time \((AEST|AEDT)\)$/)).toBeVisible();

      // The organiser's name links to their profile; there's no separate More from link.
      await expect(page.getByRole("link", { name: event.organiserName, exact: true }).first()).toHaveAttribute(
        "href",
        "/organisers/org-demo",
      );
      await expect(page.getByRole("link", { name: /^More from/ })).toHaveCount(0);

      // Who's Going, signed out: the count, no names or faces, and no list to open.
      const going = page.getByRole("region", { name: "Who's going" });
      await expect(going).toContainText("14");
      await expect(going.locator("[data-going-faces]")).toHaveCount(0);
      await expect(going.getByRole("button", { name: "See who’s going" })).toHaveCount(0);

      // Fees and refunds beside the tickets, linking the existing pages.
      const tickets = page.locator("#tickets");
      await expect(tickets.getByText("A$32.30 incl. booking fee")).toBeVisible();
      // (Live, the selector's own "By booking you agree to the Purchase Terms" line links them too:
      // that's consent at checkout; this is where refund conditions are.)
      const refunds = tickets.locator("dl").filter({ hasText: "Refunds" });
      // The event's own policy (the default here), with the line that always applies.
      await expect(refunds.locator("[data-refund-policy]")).toHaveText("No refunds for change of mind.");
      await expect(refunds).toContainText(REFUND_ACL_STATEMENT);
      await expect(refunds.getByRole("link", { name: "Request a refund" })).toHaveAttribute("href", "/refunds");
      await expect(refunds.getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");

      await noSidewaysScroll(page);
    });
  });
}

test.describe("an event outside Victoria (owner plan S5)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("a Perth event shows its times in Perth time and labels them 'Perth time (AWST)'", async ({ page }) => {
    // Sat 6 Mar 2027: 6:00 pm – 10:00 pm AWST (9:00 pm – 1:00 am in Melbourne).
    const event: PublicEvent = {
      ...asPublic("neon-static"),
      state: "WA",
      timeZone: "Australia/Perth",
      startsAt: "2027-03-06T10:00:00.000Z",
      endsAt: "2027-03-06T14:00:00.000Z",
    };
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: event });
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: false } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    const facts = page.locator("[data-event-facts]");
    await expect(facts.getByText("Perth time (AWST)", { exact: true })).toBeVisible();
    await expect(facts).toContainText(/Sat 6 Mar, 6:00 pm – 10:00 pm/);
    await expect(facts).not.toContainText("Melbourne time");
    await noSidewaysScroll(page);
  });
});

test.describe("refund policy at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("a days_before event says when refunds close beside the tickets, before checkout, without sideways scroll", async ({ page }) => {
    const startsAt = Date.now() + 30 * DAY;
    const event = {
      ...asPublic("neon-static"),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 3 * 3_600_000).toISOString(),
      refundPolicy: "days_before" as const,
      refundDays: 7,
    };
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: event });
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: false } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    const policy = page.locator("#tickets [data-refund-policy]");
    await expect(policy).toHaveText(
      /^Refunds available until \w{3} \d{1,2} \w{3}( \d{4})?, \d{1,2}:\d{2} [ap]m \(7 days before the event\)\.$/,
      { timeout: 30_000 },
    );
    await expect(page.locator("#tickets [data-booking-info]")).toContainText(REFUND_ACL_STATEMENT);
    await policy.scrollIntoViewIfNeeded();
    await expect(policy).toBeVisible();
    await noSidewaysScroll(page);
  });
});

test.describe("refund window already closed", () => {
  test("an event 3 days away with a 7-day policy says the window has closed, never 'up to 7 days before'", async ({ page }) => {
    const startsAt = Date.now() + 3 * DAY;
    const event = {
      ...asPublic("neon-static"),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 3 * 3_600_000).toISOString(),
      refundPolicy: "days_before" as const,
      refundDays: 7,
    };
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: event });
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: false } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    await expect(page.locator("#tickets [data-refund-policy]")).toHaveText(
      "The refund window for this event has closed. No refunds for change of mind.",
      { timeout: 30_000 },
    );
    await expect(page.locator("#tickets [data-booking-info]")).toContainText(REFUND_ACL_STATEMENT);
  });
});

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

/** A 1×1 PNG: enough for the browser to decode as the organiser's logo. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const LOGO_THUMB = "/api/organisers/org-demo/logo?size=thumb&v=1730000000000";

// docs/architecture.md, "Organiser profiles" → Logo: the thumbnail beside "Organised by", or initials.
test.describe("organiser logo at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const logo of ["served", "missing"] as const) {
    test(`${logo === "served" ? "shows the logo, decorative and out of the tab order" : "a logo that 404s shows the initials"}`, async ({ page }) => {
      const logoRequests: string[] = [];
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        if (/^\/api\/events\/slug\//.test(url.pathname)) {
          return route.fulfill({ json: { ...asPublic("neon-static"), organiserLogoThumbUrl: LOGO_THUMB } });
        }
        if (url.pathname === "/api/organisers/org-demo/logo") {
          logoRequests.push(`${url.pathname}${url.search}`);
          return logo === "served"
            ? route.fulfill({ contentType: "image/png", body: TINY_PNG })
            : route.fulfill({ status: 404, json: { error: "Organiser not found." } });
        }
        if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: false } });
        return route.fulfill({ status: 204 });
      });
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });

      const avatar = page.locator("[data-organiser-avatar]");
      await expect(avatar).toHaveAttribute("aria-hidden", "true");
      await expect(avatar).toHaveAttribute("tabindex", "-1");
      await expect(avatar).toHaveAttribute("href", "/organisers/org-demo");
      await expect.poll(() => logoRequests).toEqual([LOGO_THUMB]);
      if (logo === "served") {
        const img = avatar.locator("img");
        await expect(img).toHaveAttribute("alt", "");
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
        // The avatar's 32px square, the same as the initials it replaces.
        const box = await avatar.locator("[data-organiser-logo]").boundingBox();
        expect(box?.width).toBe(32);
        expect(box?.height).toBe(32);
      } else {
        await expect(avatar.locator("img")).toHaveCount(0);
        await expect(avatar).toHaveText("SC");
      }
      await noSidewaysScroll(page);
    });
  }
});

/** A 16×16 grey PNG for every basemap tile (as e2e/map-tiles.spec.ts): the map loads without the network. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR42mM4QSJgOHHixCNSwKiGUQ1DRwMAAaucrZWSFIMAAAAASUVORK5CYII=",
  "base64",
);

// The Location section (owner request, 26 Oct 2026): after About in the main column, the venue, a
// small map loaded only as it nears the screen (a live event has no coordinates, so the pin is its
// suburb's centre, from the suburb table), and the Google Maps and Apple Maps links (owner decision
// A-D4, 27 Oct 2026). Tiles are answered here.
for (const vp of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`location section at ${vp.width}px`, () => {
    test.use({ viewport: vp });

    test("after About, with the venue, a decorative map loaded on approach, and Google and Apple Maps links", async ({ page }) => {
      await mockApi(page);
      const tiles: string[] = [];
      await page.route("https://server.arcgisonline.com/**", (route) => {
        tiles.push(route.request().url());
        return route.fulfill({ contentType: "image/png", body: TILE });
      });
      // Google Maps: a stub page, never the real site.
      await page.context().route(/^https:\/\/www\.google\.com\/maps\//, (route) =>
        route.fulfill({ contentType: "text/html", body: "<title>Maps</title><p>stub</p>" }),
      );
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      const event = sampleEvents.find((e) => e.slug === "neon-static");
      if (!event) throw new Error("no sample");
      const address = `${event.venueName}, ${event.venueAddress}`;
      const href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

      // Straight after About (the live API sends no Good to know details).
      const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
      expect(headings.slice(headings.indexOf("About this event"), headings.indexOf("About this event") + 2)).toEqual([
        "About this event",
        "Location",
      ]);
      const location = page.getByRole("region", { name: "Location" });
      await expect(location).toContainText(event.venueName);
      await expect(location).toContainText(event.venueAddress);

      // Below the fold on a phone: nothing of the map has loaded yet.
      const map = location.locator("[data-event-map]");
      if (vp.width < 1024) {
        await expect(location.locator(".leaflet-container")).toHaveCount(0);
        expect(tiles).toEqual([]);
      }

      await map.scrollIntoViewIfNeeded();
      await expect(location.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
      await expect(location.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 20_000 });
      expect(tiles.length).toBeGreaterThan(0);
      // One pin, in /map's marker style, and Esri's credit on show.
      await expect(location.locator(".leaflet-marker-icon")).toHaveCount(1);
      await expect(location.locator(".leaflet-control-attribution")).toContainText("Esri");
      // A suburb's centre, said so; never a claim of the exact spot.
      await expect(location).toContainText("The pin marks Collingwood, VIC, not the venue’s exact spot.");

      // Hidden from assistive technology and the keyboard: the named controls are the two map links,
      // both always there (no user-agent sniffing).
      await expect(map).toHaveAttribute("aria-hidden", "true");
      const google = location.getByRole("link", {
        name: `Google Maps: directions to ${address} (opens in a new tab)`,
      });
      await expect(google).toHaveText("Google Maps");
      await expect(google).toHaveAttribute("href", href);
      await expect(google).toHaveAttribute("target", "_blank");
      const apple = location.getByRole("link", {
        name: `Apple Maps: directions to ${address} (opens in a new tab)`,
      });
      await expect(apple).toHaveText("Apple Maps");
      await expect(apple).toHaveAttribute("href", `https://maps.apple.com/?daddr=${encodeURIComponent(event.venueAddress)}`);
      await expect(apple).toHaveAttribute("target", "_blank");
      await expect(location.getByRole("link")).toHaveCount(2);
      for (const link of [google, apple]) {
        const linkBox = await link.boundingBox();
        expect(linkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(linkBox?.width ?? 0).toBeGreaterThanOrEqual(24);
      }

      // The box keeps its size: ~200px on phones, 256px on desktop.
      const box = await map.locator("[data-surface]").boundingBox();
      expect(box?.height).toBe(vp.width < 1024 ? 208 : 256);

      // A wheel over the map scrolls the page, never the map.
      const before = await page.evaluate(() => window.scrollY);
      const centre = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.wheel(0, 200);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);

      await noSidewaysScroll(page);

      // A tap on the map opens directions too.
      await map.scrollIntoViewIfNeeded();
      const mapBox = await map.locator("[data-surface]").boundingBox();
      if (!mapBox) throw new Error("map not laid out");
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 3),
      ]);
      await expect(popup).toHaveURL(href);
      await popup.close();
    });
  });
}
