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

  test("buy bar Get tickets focuses the tickets, whose totals include the fee and come first", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toContainText("From A$31.70", { timeout: 30_000 });
    await bar.getByRole("link", { name: "Get tickets" }).click();
    await expect(page).toHaveURL(/#tickets$/);
    await expect(page.locator("#tickets")).toBeFocused();
    const tickets = page.locator("#tickets");
    await expect(tickets.getByText("A$31.70 incl. booking fee")).toBeVisible();
    // The breakdown is there before anything's chosen.
    await expect(tickets.getByText("A$30 ticket + A$1.70 booking fee")).toBeVisible();
    await noSidewaysScroll(page);
  });
});
