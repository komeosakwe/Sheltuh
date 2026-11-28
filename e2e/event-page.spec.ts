import { devices, expect, test, type Page } from "@playwright/test";
import type { PublicEvent } from "@/lib/api/public-events";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
import { sampleEvents } from "@/lib/sample-events";
import { focusWithoutScrollLikeIOS, pressFocusLikeWebKit } from "./webkit-focus";

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
    ...(event.externalPriceFromCents ? { externalPriceFromCents: event.externalPriceFromCents } : {}),
    externalProvider: event.externalProvider ?? null,
    // The organiser's "Before you go" note, as the live API sends it (Neon Static has one).
    ...(event.beforeYouGo ? { beforeYouGo: event.beforeYouGo } : {}),
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
    // The count-only "going" of an external event (not Who's Going, so not in `going`).
    if (/\/external-going$/.test(url.pathname)) {
      return route.fulfill({ json: { count: 12, countHidden: false, closed: false } });
    }
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

  test("links out from the ticket panel with the click beacon; the organiser's price, no tickets section, selector or Who's Going", async ({ page }) => {
    const { outbound, going } = await mockApi(page);
    await page.goto("/events/thornbury-dub-session");
    // The panel is the only place with the price and the link from 1024px: no tickets section repeats them (owner, 15 Nov 2026).
    const tickets = page.locator("[data-ticket-panel]");
    const link = tickets.getByRole("link", { name: "Buy tickets (opens in a new tab)" });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", "https://events.humanitix.com/thornbury-dub-session-demo");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveText("Buy tickets");
    await expect(page.locator("#tickets")).toHaveCount(0);
    // The ticketing site is never named (owner, 31 Oct 2026): buyers go through our link.
    await expect(tickets).not.toContainText(/Humanitix|Sold by|Tickets on|organiser.s site/i);
    await expect(tickets).not.toContainText("Tickets coming soon");
    // The organiser's own price, labelled; never ours (no booking fee).
    await expect(tickets).toContainText("From A$35");
    await expect(tickets).toContainText("Price set by the organiser.");
    await expect(tickets).not.toContainText("incl. booking fee");
    // No Sheltüh refund policy (the other site's terms apply).
    await expect(tickets).not.toContainText("change of mind");
    await expect(tickets).not.toContainText("Australian Consumer Law");
    // Only the count-only "Who's going": no names, no list, no Who's Going requests.
    await expect(page.getByRole("button", { name: /see who.s going/i })).toHaveCount(0);

    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await expect(popup).toHaveURL("https://events.humanitix.com/thornbury-dub-session-demo");
    await expect.poll(() => outbound).toEqual(["/api/events/evt-thornbury-dub-session/outbound"]);
    // The opener isn't exposed to the other site.
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(going).toEqual([]);
    await noSidewaysScroll(page);
  });
});

test.describe("external event: count-only going at 375×812", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("shows '12 going' and an I'm going link that signs in and comes back to the event", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/thornbury-dub-session");
    const section = page.getByRole("region", { name: "Who's going" });
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section).toContainText("12 going");
    const link = section.getByRole("link", { name: "I’m going" });
    await expect(link).toHaveAttribute("href", "/login?next=%2Fevents%2Fthornbury-dub-session");
    // After the About section, before Location.
    const order = await page.evaluate(() =>
      ["about-title", "external-going-title"].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1),
    );
    expect(order[0]).toBeLessThan(order[1]);
    await noSidewaysScroll(page);
    if (process.env.EXTGOING_SHOTS) await section.screenshot({ path: `${process.env.EXTGOING_SHOTS}/signed-out-count.png` });
  });
});

test.describe("external event (free, organiser's site) at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the buy bar shows only the price and is the outbound link itself, never naming the site", async ({ page }) => {
    const { outbound } = await mockApi(page);
    await page.goto("/events/footscray-open-studios");
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText("Free");
    await expect(bar).not.toContainText(/Tickets on|organiser.s site|Humanitix/i);
    const cta = bar.getByRole("link", { name: "Buy tickets (opens in a new tab)" });
    await expect(cta).toHaveText("Buy tickets");
    await expect(cta).toHaveAttribute("href", "https://www.example.com/footscray-open-studios/rsvp");
    await expect(page.locator("#tickets")).toHaveCount(0);
    await expect(page.getByText("Tickets coming soon")).toHaveCount(0);
    const [popup] = await Promise.all([page.waitForEvent("popup"), cta.click()]);
    await popup.close();
    await expect.poll(() => outbound.length).toBe(1);
    await noSidewaysScroll(page);
  });
});

test.describe("Sheltüh-ticketed event at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("buy bar Choose tickets focuses the first ticket, whose totals include the fee and come first", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    const bar = page.locator("[data-buy-bar]");
    await expect(bar).toContainText("From A$32.30", { timeout: 30_000 });
    // The tab is titled with the event once it's loaded (live pages render client-side).
    await expect(page).toHaveTitle("Neon Static — Sheltüh");
    // With nothing chosen the bar's link takes focus to the first ticket's "+" (and, if that is already on
    // screen, says what to do: tests/BuyBar.test.tsx), rather than jumping to the section.
    await bar.getByRole("link", { name: "Choose tickets" }).click();
    const tickets = page.locator("#tickets");
    await expect(tickets.getByRole("button", { name: "Increase quantity for General admission" })).toBeFocused();
    await expect(tickets.getByText("A$32.30 incl. booking fee")).toBeVisible();
    // No per-ticket breakdown: the fee is said once, by Checkout.
    await expect(tickets.getByText("A$30 ticket + A$2.30 booking fee")).toHaveCount(0);
    await expect(tickets.getByText("Prices include a booking fee of 6% of ticket face value + A$0.50 per paid ticket.")).toBeVisible();
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

// Owner request (26 Oct 2026): on a phone, Save and Share are on the first screen too, above the buy bar, with a
// two-line title (the redesign's title is 32px on phones, so the longest sample title still takes two lines). Since
// the owner chose Option A (27 Nov 2026) they're on the photo's top-right corner, the first thing under the header,
// and every other action sits on its object: Add to calendar under the date, the venue itself the directions link,
// "Hosted by" the title's byline. This must hold on a 667px-tall phone (an iPhone SE) as on a full-height phone
// (390×844, 375×812, and 370×812 where a slightly wider font wraps one more line).
for (const vp of [
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 375, height: 667 },
  { width: 370, height: 812 },
]) {
  test.describe(`Save and Share on the first screen at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("laneway-projections-after-dark: Save and Share are on the photo, under the header and above the buy bar", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/laneway-projections-after-dark");
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // The case it's for: a two-line title, and the venue's full group (its name with the address under it, one
      // directions link). The title shows as entered (Round 2 §1.7: no CSS capitals), which is narrower: one line at
      // 390, still two at 375 and 370.
      const lines = (el: HTMLElement) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      expect(await h1.evaluate(lines)).toBe(vp.width >= 390 ? 1 : 2);
      await expect(page.locator("[data-event-facts] [data-venue-address]")).toBeVisible();

      const bar = await page.locator("[data-buy-bar]").boundingBox();
      const header = await page.locator("header").first().boundingBox();
      const photo = await page.locator("[data-event-actions]").locator("xpath=..").boundingBox();
      if (!bar || !header || !photo) throw new Error("not laid out");
      const actions = page.locator("[data-event-actions]");
      const save = actions.getByRole("link", { name: "Sign in to save Laneway Projections: After Dark" });
      const share = actions.getByRole("button", { name: "Share Laneway Projections: After Dark" });
      for (const control of [save, share]) {
        const box = await control.boundingBox();
        if (!box) throw new Error("not laid out");
        // A 48px target (44px is the floor) around a 40px mark.
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        // Wholly in view: under the sticky header, and with room to spare (4px) above the bar, not touching it.
        expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
        expect(box.y + box.height).toBeLessThanOrEqual(bar.y - 4);
        // On the photo, inside its box.
        expect(box.x).toBeGreaterThanOrEqual(photo.x);
        expect(box.x + box.width).toBeLessThanOrEqual(photo.x + photo.width + 0.5);
        expect(box.y).toBeGreaterThanOrEqual(photo.y);
        expect(box.y + box.height).toBeLessThanOrEqual(photo.y + photo.height + 0.5);
      }
      // Add to calendar, under the date, keeps its 44px target, above the venue link and clear of it; the venue link
      // (its name and address) is a 44px target too, and the facts end above the bar.
      const calendar = await page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" }).boundingBox();
      const venue = await page.locator("[data-event-facts] [data-directions]").boundingBox();
      if (!calendar || !venue) throw new Error("not laid out");
      expect(calendar.height).toBeGreaterThanOrEqual(44);
      expect(venue.height).toBeGreaterThanOrEqual(44);
      expect(calendar.y + calendar.height).toBeLessThanOrEqual(venue.y);
      expect(venue.y + venue.height).toBeLessThanOrEqual(bar.y);
      await noSidewaysScroll(page);
    });
  });
}

// Who's going's row: below lg it comes after the facts, so an event with a going count keeps Save and Share above the
// bar too (UX review, PR 4); they're on the photo, before the title (owner, 27 Nov 2026: Option A).
test.describe("Save and Share on the first screen with a going count, at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("laneway-projections-after-dark with 42 going: Save and Share still end above the buy bar, the row under the facts", async ({ page }) => {
    await mockApi(page);
    await page.route(/\/api\/events\/[^/]+\/going$/, (route) => route.fulfill({ json: { count: 42, countHidden: false, closed: false } }));
    await page.goto("/events/laneway-projections-after-dark");
    const row = page.getByRole("region", { name: "Who’s going?" });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("42 going");
    const bar = await page.locator("[data-buy-bar]").boundingBox();
    if (!bar) throw new Error("no buy bar");
    const actions = page.locator("[data-event-actions]");
    for (const control of [
      actions.getByRole("link", { name: "Sign in to save Laneway Projections: After Dark" }),
      actions.getByRole("button", { name: "Share Laneway Projections: After Dark" }),
    ]) {
      const box = await control.boundingBox();
      if (!box) throw new Error("not laid out");
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y - 4);
    }
    const actionsBox = await actions.boundingBox();
    const rowBox = await row.boundingBox();
    // Save and Share on the photo, above the title and its byline; Who's going after the facts.
    const organiserBox = await page.locator("[data-event-organiser]").boundingBox();
    const factsBox = await page.locator("[data-event-facts]").boundingBox();
    const h1Box = await page.getByRole("heading", { level: 1 }).boundingBox();
    if (!actionsBox || !rowBox || !organiserBox || !factsBox || !h1Box) throw new Error("not laid out");
    expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(h1Box.y);
    expect(factsBox.y).toBeGreaterThanOrEqual(organiserBox.y + organiserBox.height);
    expect(rowBox.y).toBeGreaterThanOrEqual(factsBox.y + factsBox.height);
    // Its button is the rules' Secondary M: 48px.
    expect((await row.getByRole("link").last().boundingBox())?.height).toBe(48);
    await noSidewaysScroll(page);
  });
});

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

// Option A from 640px (owner, 27 Nov 2026): Save and Share are labelled chips on the photo's top-right corner, 44px tall
// and 12px in; the sticky ticket panel is just the price and the one orange action; the back link is back.
test.describe("Save and Share on the photo at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("labelled 44px chips on the photo; the panel only the price and Buy tickets", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("link", { name: "Back to all events" })).toBeVisible();

    const actions = page.locator("[data-event-actions]");
    const photo = await actions.locator("xpath=..").boundingBox();
    const share = actions.getByRole("button", { name: "Share Neon Static" });
    const save = actions.getByRole("link", { name: "Sign in to save Neon Static" });
    await expect(share).toHaveText("ShareCopied");
    await expect(share.getByText("Share", { exact: true })).toBeVisible();
    await expect(save.getByText("Save", { exact: true })).toBeVisible();
    const [shareBox, saveBox] = await Promise.all([share.boundingBox(), save.boundingBox()]);
    if (!photo || !shareBox || !saveBox) throw new Error("not laid out");
    for (const box of [shareBox, saveBox]) {
      expect(box.height).toBe(44);
      expect(Math.round(box.y - photo.y)).toBe(12);
    }
    expect(Math.round(photo.x + photo.width - (saveBox.x + saveBox.width))).toBe(12);
    expect(Math.round(saveBox.x - (shareBox.x + shareBox.width))).toBe(8);

    // The panel: the price and the one orange action, nothing else.
    const panel = page.locator("[data-ticket-panel]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("From A$32.30");
    await expect(panel.getByRole("link", { name: "Buy tickets" })).toBeVisible();
    // Nothing else to press in it: no Save, Share or Add to calendar.
    await expect(panel.getByRole("link")).toHaveCount(1);
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" })).toBeVisible();
    await noSidewaysScroll(page);
  });
});

// Forced colours (Windows High Contrast) don't draw box-shadows, so the photo marks' two-tone ring vanishes there. Their
// own outline is `outline-hidden` (a transparent outline the system paints in forced colours), so focus still shows.
test.describe("photo marks' focus in forced colours, at 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Share and Save keep a visible outline when focused; with colours on, the ring shows instead", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    const actions = page.locator("[data-event-actions]");
    const share = actions.getByRole("button", { name: "Share Neon Static" });
    const save = actions.getByRole("link", { name: "Sign in to save Neon Static" });
    const outline = (el: HTMLElement | SVGElement) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    };
    const ring = (el: HTMLElement | SVGElement) => getComputedStyle(el.firstElementChild as Element).boxShadow;

    // Colours on: no outline on the target; the mark's ring is the focus indicator.
    await share.focus();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    expect((await save.evaluate(outline)).style).toBe("none");
    await expect.poll(() => save.evaluate(ring)).not.toBe("none");

    await page.emulateMedia({ forcedColors: "active" });
    for (const [control, back] of [
      [save, false],
      [share, true],
    ] as const) {
      if (back) await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
      const { style, width } = await control.evaluate(outline);
      expect(style).not.toBe("none");
      expect(width).toBeGreaterThanOrEqual(2);
    }
    // Not focused: no outline (it's a focus indicator only).
    expect((await save.evaluate(outline)).style).toBe("none");
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

test.describe("share popover on an iPhone-sized touch screen, as WebKit moves focus", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("tapping Copy runs it (it used to close the popover first)", async ({ page }) => {
    await pressFocusLikeWebKit(page);
    await mockApi(page);
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
    const popover = page.getByRole("group", { name: "Copy the link" });
    await expect(async () => {
      if (!(await popover.isVisible())) await share.tap();
      await expect(popover.getByRole("textbox", { name: "Link to this event" })).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await popover.getByRole("button", { name: "Copy" }).tap();
    // Copy ran and still can't: it says so, in the popover, still open.
    await expect(popover.getByText(/Couldn’t copy it automatically/)).toBeVisible();
  });
});

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
      /^https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose\?path=\/calendar\/action\/compose&rru=addevent&subject=Neon%20Static&startdt=/,
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

// Review (PR 113): with 200% text the list (16rem wide) hung from the link, an icon's width in, and ran off the right
// edge at 320 and 375. It's narrowed to the screen less its gutters and moved left to fit.
for (const width of [320, 375]) {
  test.describe(`add to calendar at ${width}px with 200% text`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });

    test("the open list stays inside the screen and adds no sideways scroll", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      await page.addStyleTag({ content: "html{font-size:200% !important}" });
      await page.evaluate(() => document.fonts.ready);
      const trigger = page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" });
      await trigger.scrollIntoViewIfNeeded();
      // The page's own sideways overflow before the list opens: at 320px with 200% text the site footer's theme
      // switch already reaches past the edge (outside this page's scope, as the large-text checks below note).
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const before = await overflow();
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const menu = page.locator(`#${await trigger.getAttribute("aria-controls")}`);
      await expect(menu.getByRole("link")).toHaveCount(4);
      const box = await menu.boundingBox();
      if (!box) throw new Error("menu not laid out");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // Every row inside it, whole.
      for (const link of await menu.getByRole("link").all()) {
        const row = await link.boundingBox();
        if (!row) throw new Error("row not laid out");
        expect(row.x + row.width).toBeLessThanOrEqual(width);
      }
      // Opening it adds no sideways scroll, and nothing on the event page itself reaches past the edge.
      expect(await overflow()).toBeLessThanOrEqual(Math.max(0, before));
      const wide = await page.evaluate(() =>
        [...document.querySelectorAll("main *")]
          .filter((el) => !el.closest("footer") && el.getBoundingClientRect().right > window.innerWidth + 1)
          .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`),
      );
      expect(wide).toEqual([]);
      if (process.env.EVENT_SHOTS) await page.screenshot({ path: `${process.env.EVENT_SHOTS}/calendar-list-${width}-text200.png` });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
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

      // The venue and its address are the directions link (owner, 27 Nov 2026: Option A), out to Google Maps in a new tab.
      const directions = page.getByRole("link", { name: `${address}: get directions (opens Google Maps in a new tab)` });
      await expect(directions).toHaveAttribute("href", `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
      await expect(directions).toHaveAttribute("target", "_blank");
      await expect(directions).toHaveAttribute("rel", "noopener noreferrer");
      await expect(directions).toHaveText(`${event.venueName}${event.venueAddress}`);
      await expect(page.getByText("Get directions", { exact: true })).toHaveCount(0);
      await expect(page.locator("[data-event-facts] [data-venue-address]")).toHaveText(event.venueAddress);
      expect((await directions.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      // The zone in effect at the start (a week out from now: AEST or AEDT).
      await expect(page.getByText(/^Melbourne time \((AEST|AEDT)\)$/)).toBeVisible();

      // The organiser's name links to their profile; there's no View organiser or separate More from link.
      await expect(page.getByRole("link", { name: event.organiserName, exact: true })).toHaveAttribute(
        "href",
        "/organisers/org-demo",
      );
      await expect(page.getByRole("link", { name: /^More from/ })).toHaveCount(0);
      await expect(page.getByText(/View organiser/)).toHaveCount(0);

      // Who's Going, signed out: the count, no names or faces, and no list to open.
      const going = page.getByRole("region", { name: "Who's going" });
      await expect(going).toContainText("14");
      await expect(going.locator("[data-going-faces]")).toHaveCount(0);
      await expect(going.getByRole("button", { name: "See who’s going" })).toHaveCount(0);

      // Fees in the tickets panel; refunds after Who's Going, linking the existing pages.
      const tickets = page.locator("#tickets");
      await expect(tickets.getByText("A$32.30 incl. booking fee")).toBeVisible();
      // (Live, the selector's own "By booking you agree to the Purchase Terms" line links them too:
      // that's consent at checkout; this is where refund conditions are.)
      const refunds = page.locator("[data-booking-info]");
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
    const policy = page.locator("[data-booking-info] [data-refund-policy]");
    await expect(policy).toHaveText(
      /^Refunds available until \w{3} \d{1,2} \w{3}( \d{4})?, \d{1,2}:\d{2} [ap]m \(7 days before the event\)\.$/,
      { timeout: 30_000 },
    );
    await expect(page.locator("[data-booking-info]")).toContainText(REFUND_ACL_STATEMENT);
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
    await expect(page.locator("[data-booking-info] [data-refund-policy]")).toHaveText(
      "The refund window for this event has closed. No refunds for change of mind.",
      { timeout: 30_000 },
    );
    await expect(page.locator("[data-booking-info]")).toContainText(REFUND_ACL_STATEMENT);
  });
});

test.describe("ended event at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  // A7 (accessibility review, 22 Oct 2026): no buy bar at all once the event has ended.
  test("no buy bar; the tickets panel says it has ended, and Save stays on the photo", async ({ page }) => {
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
    // Signed out, Save is a sign-in link; the one on the photo stays (owner, 27 Nov 2026: Option A).
    await expect(page.locator("[data-event-actions]").getByRole("link", { name: "Sign in to save Neon Static" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Sign in to save Neon Static" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Sign in to save Neon Static" })).toBeVisible();
    // No refunds row where nothing can be bought (A6).
    await expect(page.locator("[data-booking-info]")).toHaveCount(0);
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

    test("after About and Who's Going, with the venue, a decorative map loaded on approach, and Google and Apple Maps links", async ({ page }) => {
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

      // The owner's order (30 Oct 2026): About, Who's Going, then Location (the live API sends no Good to know details),
      // with the organiser's Before you go rows ("The essentials.") just before Location when there are any (Neon Static has).
      const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
      const about = headings.indexOf("About this event");
      expect(about).toBeGreaterThanOrEqual(0);
      expect(headings.slice(about, about + 4).map((h) => h.replace(/\u2019/g, "'"))).toEqual([
        "About this event",
        "Who's going",
        "The essentials.",
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

// docs/architecture.md, "Photo focus": the page's photo is cropped on the organiser's focus point.
test.describe("event photo focus", () => {
  test("the event page's photo is cropped on the focus point", async ({ page }) => {
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (/^\/api\/events\/slug\//.test(url.pathname)) {
        return route.fulfill({ json: { ...asPublic("neon-static"), imageUrl: "/events/dj-crate-digging.jpg", imageFocus: { x: 15, y: 70 } } });
      }
      if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: false, closed: false } });
      return route.fulfill({ status: 204 });
    });
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    // The photo may fall back to the poster art if the file doesn't exist; the style is on the image element while it's there.
    await expect(page.locator("img[style*='object-position']").first()).toHaveCSS("object-position", "15% 70%");
  });
});

// docs/architecture.md, "Sequential ticket releases": a tier that opens when the one above sells out is shown, not buyable.
for (const vp of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "375px", width: 375, height: 740 },
]) {
  test.describe(`sequential ticket releases at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("a waiting tier says what it opens after, has no stepper, and the page doesn't scroll sideways", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/cinder-warehouse-sessions");
      const tickets = page.locator("#tickets");
      const second = tickets.getByRole("listitem").filter({ has: page.getByText("Second release", { exact: true }) });
      await expect(second).toBeVisible({ timeout: 30_000 });
      await expect(second).toContainText("Opens after First release");
      await expect(second.getByRole("button")).toHaveCount(0);
      const third = tickets.getByRole("listitem").filter({ has: page.getByText("Final release", { exact: true }) });
      await expect(third).toContainText("Opens after Second release");
      await expect(third.getByRole("button")).toHaveCount(0);
      // Only the first release can be chosen.
      await expect(tickets.getByRole("button", { name: /Increase quantity/ })).toHaveCount(1);
      await expect(tickets.getByRole("button", { name: "Increase quantity for First release" })).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}

// The owner's event reference (13 Nov 2026), at the three phone widths: the details as two icon groups, "Hosted by"
// as the title's byline with the name the link (owner, 27 Nov 2026), Save and Share as 40px marks on the photo, Add to
// calendar under the date and the venue the directions link (owner, 27 Nov 2026: Option A), ticket rows each with their own stepper,
// and the sticky bar's starting price before a choice and the total after. Edge cases: a long title, venue and
// address, several long-named tiers, and a sold-out event. Fixtures live here only (never in the sample data).
// EVENT_SHOTS=<dir> saves screenshots of each for visual review.
const LONG_EVENT: PublicEvent = {
  ...asPublic("neon-static"),
  title: "The Extraordinarily Long-Named Midsummer Experimental Sound and Light Festival",
  venueName: "The Old Melbourne Mechanics' Institute Grand Ballroom and Annexe",
  venueAddress: "1234 Long Example Boulevard, North Melbourne Industrial Precinct VIC 3051",
  organiserName: "The Collective of Very Patient Experimental Sound Makers",
  ticketTypes: [
    { id: "t-early", name: "Early bird (limited, includes a commemorative risograph poster)", priceCents: 2500, feePolicy: "buyer-pays", quantityAvailable: 50 },
    { id: "t-ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 },
    { id: "t-conc", name: "Concession", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 40 },
    { id: "t-vip", name: "VIP", priceCents: 9900, feePolicy: "buyer-pays", quantityAvailable: 10, soldOut: true, remaining: 0 },
  ],
};

async function mockEvent(page: Page, event: PublicEvent) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/events\/slug\//.test(url.pathname)) return route.fulfill({ json: event });
    if (/\/going$/.test(url.pathname)) return route.fulfill({ json: { count: 0, countHidden: true, closed: false } });
    if (/\/view$/.test(url.pathname)) return route.fulfill({ status: 204 });
    // The organiser's profile and the rest: not part of these checks.
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

/**
 * "Hosted by {name}", the title's byline (owner, 27 Nov 2026): the element straight after the h1 and before the
 * facts, the name the one link (no View organiser), a 44px target on phones whose text never overlaps the title or
 * the facts, and never wider than the row however the name wraps.
 */
async function expectByline(page: Page, name: string) {
  const organiser = page.locator("[data-event-organiser]");
  expect(await organiser.evaluate((el) => el.previousElementSibling?.tagName)).toBe("H1");
  expect(await organiser.evaluate((el) => el.nextElementSibling?.hasAttribute("data-event-facts"))).toBe(true);
  await expect(organiser).toContainText(`Hosted by ${name}`);
  await expect(organiser).not.toContainText("View organiser");
  const link = organiser.getByRole("link", { name, exact: true });
  await expect(link).toHaveAttribute("href", "/organisers/org-demo");
  await expect(organiser.getByRole("link")).toHaveCount(1);
  // Mid-screen, clear of the header and the buy bar (with large text the bar can reach up to it).
  await link.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const [h1, row, facts, target] = await Promise.all([
    page.getByRole("heading", { level: 1 }).boundingBox(),
    organiser.boundingBox(),
    page.locator("[data-event-facts]").boundingBox(),
    link.boundingBox(),
  ]);
  if (!h1 || !row || !facts || !target) throw new Error("byline not laid out");
  expect(row.y).toBeGreaterThanOrEqual(h1.y + h1.height);
  expect(facts.y).toBeGreaterThanOrEqual(row.y + row.height);
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.x + target.width).toBeLessThanOrEqual(row.x + row.width + 1);
  // The name's text (the target less its padding above and below: 10px, more with larger text) stays between the title
  // and the facts.
  const pad = await link.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(pad).toBeGreaterThanOrEqual(10);
  expect(target.y + pad).toBeGreaterThanOrEqual(h1.y + h1.height - 1);
  expect(target.y + target.height - pad).toBeLessThanOrEqual(facts.y + 1);
  // The whole target is the link: a tap at its top edge, above the text, still lands on it.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href"), [target.x + 4, target.y + 2]);
  expect(hit).toBe("/organisers/org-demo");
}

async function shoot(page: Page, name: string) {
  if (!process.env.EVENT_SHOTS) return;
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `${process.env.EVENT_SHOTS}/${name}.png`, fullPage: true });
  await page.screenshot({ path: `${process.env.EVENT_SHOTS}/${name}-fold.png` });
  await page.locator("#tickets").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${process.env.EVENT_SHOTS}/${name}-tickets.png` });
}

for (const width of [320, 390, 430]) {
  test.describe(`event page reference layout at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });

    test("details groups, Hosted by, Save and Share on the photo, ticket rows and the bar before and after a choice", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);

      // Two groups, each an icon beside its text: When (the range, the zone, then Add to calendar) and Where (the venue
      // and its address, one directions link).
      for (const group of ["[data-event-when]", "[data-event-where]"]) {
        const icon = await page.locator(`${group} dt svg`).boundingBox();
        const text = await page.locator(`${group} dd`).boundingBox();
        if (!icon || !text) throw new Error(`${group} not laid out`);
        expect(icon.x + icon.width).toBeLessThanOrEqual(text.x);
      }
      await expect(page.locator("[data-event-where] [data-venue-address]")).toBeVisible();
      await expect(page.locator("[data-event-where] [data-directions]")).toHaveText("Warehouse 99 Rupert Street, Collingwood VIC 3066");
      await expect(page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" })).toHaveText("Add to calendar");

      // Hosted by, the title's byline, with the name the link to the profile.
      await expectByline(page, "Static Collective");

      // Share then Save on the photo's top-right corner: 48px targets that touch, around white 40px marks 8px in from
      // the photo's edges and 8px apart, icons only (their words come from 640px). No date chip on the photo.
      const actions = page.locator("[data-event-actions]");
      const photo = await actions.locator("xpath=..").boundingBox();
      const controls = [actions.getByRole("button", { name: "Share Neon Static" }), actions.getByRole("link", { name: "Sign in to save Neon Static" })];
      const marks = await Promise.all(controls.map((c) => c.locator("[data-surface='paper']").boundingBox()));
      const targets = await Promise.all(controls.map((c) => c.boundingBox()));
      if (!photo || marks.some((m) => !m) || targets.some((t) => !t)) throw new Error("Save and Share not laid out");
      const [shareMark, saveMark] = marks as NonNullable<(typeof marks)[number]>[];
      const [shareTarget, saveTarget] = targets as NonNullable<(typeof targets)[number]>[];
      for (const t of [shareTarget, saveTarget]) expect([t.width, t.height]).toEqual([48, 48]);
      for (const m of [shareMark, saveMark]) expect([m.width, m.height]).toEqual([40, 40]);
      expect(Math.round(photo.x + photo.width - (saveMark.x + saveMark.width))).toBe(8);
      expect(Math.round(saveMark.y - photo.y)).toBe(8);
      expect(Math.round(shareMark.y - photo.y)).toBe(8);
      expect(Math.round(saveMark.x - (shareMark.x + shareMark.width))).toBe(8);
      for (const control of controls) {
        await expect(control.getByText(/^(Save|Share)$/)).toBeHidden();
        expect(await control.evaluate((el) => getComputedStyle(el.firstElementChild as Element).backgroundColor)).toBe("rgb(255, 255, 255)");
      }
      await expect(page.locator("[data-date-chip]")).toHaveCount(0);
      // No back link on a phone (from 640px only), and the photo 8px under the header.
      await expect(page.getByRole("link", { name: "Back to all events" })).toBeHidden();
      const header = await page.locator("header").first().boundingBox();
      if (!header) throw new Error("no header");
      expect(Math.round(photo.y - (header.y + header.height))).toBe(8);

      // Before a choice: the bar's starting price, and Choose tickets (it never checks out yet).
      const bar = page.locator("[data-buy-bar]");
      await expect(bar.locator("[data-bar-amount]")).toHaveText("From A$32.30");
      await expect(bar.locator("[data-bar-note]")).toHaveText("incl. booking fee");
      await expect(bar.getByRole("button")).toHaveCount(0);
      // Flat Signal Orange (#ff4800) with a black label.
      const cta = bar.getByRole("link", { name: "Choose tickets" });
      expect(await cta.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).backgroundImage, getComputedStyle(el).boxShadow])).toEqual([
        "rgb(255, 72, 0)",
        "rgb(0, 0, 0)",
        "none",
        "none",
      ]);
      // The bar keeps its padding under the action (plus the home indicator's safe area on an iPhone).
      expect(parseFloat(await bar.evaluate((el) => getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(8);

      // Each ticket type is a row with its own stepper inside it; pressing + is never blocked by the bar.
      const tickets = page.locator("#tickets");
      await expect(tickets.getByRole("heading", { level: 2, name: "Choose your tickets" })).toBeVisible();
      await expect(tickets.getByText("Choose how many tickets you want.")).toBeVisible();
      for (const name of ["General admission", "VIP (side-of-stage viewing)"]) {
        const row = tickets.locator("[data-ticket-card]").filter({ hasText: name });
        const rowBox = await row.boundingBox();
        const stepper = await row.getByRole("group", { name: `Quantity for ${name}` }).boundingBox();
        if (!rowBox || !stepper) throw new Error(`${name} not laid out`);
        expect(stepper.x + stepper.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
        expect(stepper.y + stepper.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
        const plus = row.getByRole("button", { name: `Increase quantity for ${name}` });
        expect((await plus.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await shoot(page, `event-after-live-${width}`);
      await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click();
      await tickets.getByRole("button", { name: "Increase quantity for General admission" }).click();
      // After a choice: the total (lib/fees.ts's, as the Order summary says it) and Buy tickets.
      await expect(bar.locator("[data-bar-amount]")).toHaveText("A$64.60");
      await expect(bar.locator("[data-bar-note]")).toHaveText("Total · incl. booking fee");
      await expect(tickets.getByText("Total").locator("xpath=following-sibling::dd")).toHaveText("A$64.60");
      await expect(bar.getByRole("button", { name: "Buy tickets" })).toBeVisible();
      if (process.env.EVENT_SHOTS) await bar.screenshot({ path: `${process.env.EVENT_SHOTS}/event-after-live-${width}-bar-selected.png` });
      await noSidewaysScroll(page);
    });

    test("edge cases: a long title, venue, address and organiser, several long-named tiers (one sold out)", async ({ page }) => {
      await mockEvent(page, LONG_EVENT);
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: LONG_EVENT.title })).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      // Long names and addresses wrap: nothing scrolls sideways.
      await noSidewaysScroll(page);
      // The long organiser name wraps under "Hosted by", all of it still the link.
      await expectByline(page, LONG_EVENT.organiserName);
      const where = page.locator("[data-event-where]");
      await expect(where).toContainText(LONG_EVENT.venueName);
      await expect(where).toContainText(LONG_EVENT.venueAddress);
      const tickets = page.locator("#tickets");
      // Every on-sale row's stepper stays inside its row, and its + can be pressed (Playwright refuses a click the
      // sticky bar would intercept).
      for (const ticket of LONG_EVENT.ticketTypes.filter((t) => !t.soldOut)) {
        const row = tickets.locator("[data-ticket-card]").filter({ hasText: ticket.name });
        const rowBox = await row.boundingBox();
        const stepper = await row.getByRole("group").boundingBox();
        if (!rowBox || !stepper) throw new Error(`${ticket.name} not laid out`);
        expect(stepper.x + stepper.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
        await row.getByRole("button", { name: `Increase quantity for ${ticket.name}` }).click();
      }
      // The sold-out tier says so instead of a stepper.
      const vip = tickets.locator("[data-ticket-card]").filter({ hasText: "VIP" });
      await expect(vip).toContainText("Sold out");
      await expect(vip.getByRole("button")).toHaveCount(0);
      await expect(page.locator("[data-buy-bar] [data-bar-note]")).toHaveText("Total · incl. booking fee");
      await noSidewaysScroll(page);
      await shoot(page, `event-after-edge-long-multitier-${width}`);
    });

    test("edge case: a sold-out event shows Sold out on every row and the bar is Join waitlist", async ({ page }) => {
      const base = asPublic("neon-static");
      await mockEvent(page, { ...base, soldOut: true, ticketTypes: base.ticketTypes.map((t) => ({ ...t, soldOut: true, remaining: 0 })) });
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      const tickets = page.locator("#tickets");
      await expect(tickets.getByRole("heading", { level: 2, name: "Tickets" })).toBeVisible();
      await expect(tickets.locator("[data-ticket-card]").filter({ hasText: "Sold out" })).toHaveCount(base.ticketTypes.length);
      await expect(tickets.getByRole("button", { name: /Increase quantity/ })).toHaveCount(0);
      const bar = page.locator("[data-buy-bar]");
      await expect(bar.locator("[data-bar-amount]")).toHaveText("Sold out");
      await expect(bar.getByRole("link", { name: "Join waitlist" })).toHaveAttribute("href", "#tickets");
      await noSidewaysScroll(page);
      await shoot(page, `event-after-edge-soldout-${width}`);
    });
  });
}

// Review (PR 113): on an event with a clip, the photo carries Save and Share at its top right and the Play chip at its
// bottom left; with large text both grow (they're sized in rem), and on a 22svh phone photo they could meet.
const CLIP_EVENT: PublicEvent = {
  ...asPublic("neon-static"),
  clip: {
    url: "/api/events/evt-neon-static/clip?v=1761000000000",
    durationMs: 12_000,
    width: 1080,
    height: 1920,
    description: "The band plays under purple lights.",
  },
};

for (const { width, scale } of [
  { width: 390, scale: 100 },
  { width: 320, scale: 200 },
  { width: 375, scale: 200 },
  { width: 390, scale: 200 },
]) {
  test.describe(`a clip's Play and the photo marks at ${width}px, ${scale}% text`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });

    test("never overlap, and all stay on the photo", async ({ page }) => {
      await mockEvent(page, CLIP_EVENT);
      await page.goto("/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
      if (scale !== 100) await page.addStyleTag({ content: `html{font-size:${scale}% !important}` });
      await page.evaluate(() => document.fonts.ready);
      const play = page.locator("[data-clip-play]");
      await expect(play).toBeVisible();
      const actions = page.locator("[data-event-actions]");
      const photo = await actions.locator("xpath=..").boundingBox();
      const playBox = await play.boundingBox();
      if (!photo || !playBox) throw new Error("not laid out");
      const inside = (b: { x: number; y: number; width: number; height: number }) =>
        b.x >= photo.x - 0.5 && b.y >= photo.y - 0.5 && b.x + b.width <= photo.x + photo.width + 0.5 && b.y + b.height <= photo.y + photo.height + 0.5;
      // The measured boxes (x, y, width, height), and the chip's narrowest possible width, in every failure message, so
      // a run elsewhere (other fonts) says what it saw.
      const round = (b: { x: number; y: number; width: number; height: number }) => [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10);
      const chipMin = await play.evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.style.cssText = "position:absolute;visibility:hidden;width:min-content";
        el.parentElement?.appendChild(clone);
        const width = clone.getBoundingClientRect().width;
        clone.remove();
        return Math.round(width * 10) / 10;
      });
      const seen = { photo: round(photo), play: round(playBox), playMinWidth: chipMin, marks: [] as number[][] };
      expect(inside(playBox), `Play off the photo: ${JSON.stringify(seen)}`).toBe(true);
      // Not just this run's font metrics: even at its narrowest (min-content), the chip fits with its inset on the left
      // and as much again on the right. (It was 240.2px in the 240px left beside its inset at 320px with 200% text:
      // inside by rounding here, a pixel out on CI's Chromium.)
      expect(playBox.x - photo.x + chipMin, `Play can't fit at its narrowest: ${JSON.stringify(seen)}`).toBeLessThanOrEqual(photo.width - (playBox.x - photo.x));
      // Nothing clipped inside the chip either.
      expect(await play.evaluate((el) => el.scrollWidth <= el.clientWidth), `Play's contents spill: ${JSON.stringify(seen)}`).toBe(true);
      for (const control of await actions.locator("a, button").all()) {
        const box = await control.boundingBox();
        if (!box) throw new Error("mark not laid out");
        seen.marks.push(round(box));
        expect(inside(box), `a mark off the photo: ${JSON.stringify(seen)}`).toBe(true);
        const overlaps =
          box.x < playBox.x + playBox.width && playBox.x < box.x + box.width && box.y < playBox.y + playBox.height && playBox.y < box.y + box.height;
        expect(overlaps, `a mark over the Play: ${JSON.stringify(seen)}`).toBe(false);
      }
      if (process.env.EVENT_SHOTS) await page.screenshot({ path: `${process.env.EVENT_SHOTS}/clip-marks-${width}-text${scale}.png` });
    });
  });
}

// Review (PR 113): the venue link with one line (an address that names its place, so nothing under it) was only 24px
// tall on a phone. It's 44px, with the line still beside the pin.
test.describe("a one-line venue link at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("is a 44px target, its line level with the pin, clear of Add to calendar", async ({ page }) => {
    await mockEvent(page, { ...asPublic("neon-static"), venueName: "", venueAddress: "9 Rupert Street, Collingwood VIC 3066" });
    await page.goto("/events/neon-static");
    await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
    const link = page.locator("[data-event-where] [data-directions]");
    await expect(link).toHaveText("9 Rupert Street, Collingwood VIC 3066");
    await expect(link.locator("[data-venue-address]")).toHaveCount(0);
    const [box, line, pin, calendar] = await Promise.all([
      link.boundingBox(),
      link.locator("span").first().boundingBox(),
      page.locator("[data-event-where] dt svg").boundingBox(),
      page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" }).boundingBox(),
    ]);
    if (!box || !line || !pin || !calendar) throw new Error("not laid out");
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The line at the top of the target, its middle within 4px of the pin's.
    expect(Math.abs(line.y + line.height / 2 - (pin.y + pin.height / 2))).toBeLessThanOrEqual(4);
    expect(calendar.y + calendar.height).toBeLessThanOrEqual(box.y + 0.5);
    await noSidewaysScroll(page);
  });
});

// UX review (13 Nov 2026): with enlarged text (the root font at 125–200%), Save and Share stay on the photo with their
// icons inside their marks, Add to calendar stays clear of the venue link, the ticket stepper still fits its row, and
// a tall buy bar drops its date line so its action is whole. EVENT_SHOTS=<dir> saves the probes.
for (const width of [320, 390]) {
  for (const scale of [125, 150, 200]) {
    test.describe(`large text at ${width}px, ${scale}%`, () => {
      test.use({ viewport: { width, height: 844 }, hasTouch: true });

      test("Save and Share, the facts, the ticket rows and the buy bar keep everything inside", async ({ page }) => {
        await mockApi(page);
        await page.goto("/events/neon-static");
        await expect(page.getByRole("heading", { level: 1, name: "Neon Static" })).toBeVisible({ timeout: 30_000 });
        await page.addStyleTag({ content: `html{font-size:${scale}% !important}` });
        await page.evaluate(() => document.fonts.ready);

        const actions = page.locator("[data-event-actions]");
        await actions.scrollIntoViewIfNeeded();
        const photo = await actions.locator("xpath=..").boundingBox();
        if (!photo) throw new Error("no photo");
        const controls = await actions.locator("a, button").all();
        expect(controls).toHaveLength(2);
        for (const control of controls) {
          // Each stays on the photo, its icon inside its white mark, and the mark inside the target.
          const box = await control.boundingBox();
          const mark = await control.locator("[data-surface='paper']").boundingBox();
          const icon = await control.locator("svg").boundingBox();
          if (!box || !mark || !icon) throw new Error("not laid out");
          expect(box.height).toBeGreaterThanOrEqual(48);
          expect(icon.width).toBeGreaterThanOrEqual(15);
          for (const [inner, outer] of [
            [icon, mark],
            [mark, box],
            [box, photo],
          ] as const) {
            expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
            expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
            expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
            expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
          }
        }
        // Add to calendar (a 44px target in rem, so it grows with the text) stays above the venue link, not over it.
        const calendar = await page.locator("[data-event-when]").getByRole("button", { name: "Add to calendar" }).boundingBox();
        const venue = await page.locator("[data-event-facts] [data-directions]").boundingBox();
        if (!calendar || !venue) throw new Error("facts not laid out");
        expect(calendar.y + calendar.height).toBeLessThanOrEqual(venue.y + 1);
        if (process.env.EVENT_SHOTS) await actions.screenshot({ path: `${process.env.EVENT_SHOTS}/event-after2-text${scale}-${width}-actions.png` });

        // The byline wraps inside its row with larger text, between the title and the facts.
        await expectByline(page, "Static Collective");

        const tickets = page.locator("#tickets");
        for (const row of await tickets.locator("[data-ticket-card]").all()) {
          const rowBox = await row.boundingBox();
          const stepper = await row.getByRole("group").boundingBox();
          if (!rowBox || !stepper) throw new Error("not laid out");
          expect(stepper.x + stepper.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
        }
        // Nothing on the event page itself reaches past the screen's edge. (The site footer's theme switch does at
        // 320px with 200% text: outside this page's scope, reported separately.)
        const wide = await page.evaluate(() =>
          [...document.querySelectorAll("main *")]
            .filter((el) => !el.closest("footer") && el.getBoundingClientRect().right > window.innerWidth + 1)
            .map((el) => `${el.tagName} ${(el.textContent ?? "").slice(0, 30)}`),
        );
        expect(wide).toEqual([]);

        // The bar never takes more than a third of the screen without dropping its date line, and its action is whole.
        const bar = page.locator("[data-buy-bar]");
        const barBox = await bar.boundingBox();
        const cta = await bar.getByRole("link", { name: "Choose tickets" }).boundingBox();
        if (!barBox || !cta) throw new Error("not laid out");
        if (barBox.height >= 844 / 3 - 1) await expect(bar.locator("[data-bar-date]")).toBeHidden();
        expect(cta.y + cta.height).toBeLessThanOrEqual(barBox.y + barBox.height);
        if (process.env.EVENT_SHOTS) {
          await tickets.locator("[data-ticket-card]").first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.EVENT_SHOTS}/event-after2-text${scale}-${width}-tickets.png` });
        }
      });
    });
  }
}

// Choose tickets in the phone bar (owner, 25 Nov 2026: on his iPhone it often didn't scroll, and he wants no outline once
// it does). Safari on an iPhone never scrolls to a button that script focuses (focusWithoutScrollLikeIOS), so the
// tickets are scrolled to on purpose, the heading under the header, before focus lands on the first "+".
test.describe("Choose tickets at 390px on an iPhone-sized touch screen", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  for (const ios of [true, false]) {
    test(`a tap from the top of the page scrolls the tickets into view, under the header and clear of the bar, with no outline${ios ? " (as iOS focuses)" : ""}`, async ({ page }) => {
      if (ios) await focusWithoutScrollLikeIOS(page);
      await mockApi(page);
      await page.goto("/events/neon-static");
      const tickets = page.locator("#tickets");
      const heading = tickets.getByRole("heading", { name: "Choose your tickets" });
      await expect(heading).toBeAttached({ timeout: 30_000 });
      await expect(page.locator("[data-buy-bar]")).toContainText("From A$32.30");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      // At the top of the page the tickets are under the bar or below the screen.
      expect(
        await page.evaluate(
          () =>
            document.querySelector("[data-quantity-increase]")!.getBoundingClientRect().top >=
            document.querySelector("[data-buy-bar]")!.getBoundingClientRect().top,
        ),
      ).toBe(true);
      // A tap where the link is, as a finger does: locator.tap() would scroll the page to the bar's link first.
      const link = (await page.locator("[data-buy-bar]").getByRole("link", { name: "Choose tickets" }).boundingBox())!;
      await page.touchscreen.tap(link.x + link.width / 2, link.y + link.height / 2);
      const plus = tickets.getByRole("button", { name: "Increase quantity for General admission" });
      await expect(plus).toBeFocused();
      // The heading's top sits just under the sticky header (the page's scroll-padding), and the first "+" is above
      // the bar, once the (smooth) scroll has settled.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const header = document.querySelector("header")!.getBoundingClientRect();
              const bar = document.querySelector("[data-buy-bar]")!.getBoundingClientRect();
              const title = document.getElementById("tickets-title")!.getBoundingClientRect();
              const plus = document.querySelector("[data-quantity-increase]")!.getBoundingClientRect();
              return title.top >= header.bottom && title.top <= header.bottom + 24 && plus.bottom <= bar.top;
            }),
          { timeout: 5_000 },
        )
        .toBe(true);
      await expect(tickets.locator("[data-choose-hint]")).toHaveText("Use + to add a ticket.");
      await expect(tickets.locator("[data-choose-hint]")).toBeInViewport();
      // No outline anywhere in the tickets: not round the first row, the heading, the section or the focused "+".
      const outlined = await page.evaluate(() =>
        [document.getElementById("tickets")!, ...document.querySelectorAll("#tickets *")]
          .filter((el) => getComputedStyle(el).outlineStyle !== "none")
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      expect(outlined).toEqual([]);
      if (process.env.EVENT_SHOTS) await page.screenshot({ path: `${process.env.EVENT_SHOTS}/choose-tickets-390${ios ? "-ios" : ""}.png` });
      // The hint goes once a quantity changes.
      await plus.tap();
      await expect(tickets.locator("[data-choose-hint]")).toHaveCount(0);
    });
  }

  test("Tab still rings the + (keyboard focus keeps the global focus-visible ring)", async ({ page }) => {
    await mockApi(page);
    await page.goto("/events/neon-static");
    const tickets = page.locator("#tickets");
    const minus = tickets.getByRole("button", { name: "Decrease quantity for General admission" });
    const plus = tickets.getByRole("button", { name: "Increase quantity for General admission" });
    await expect(minus).toBeAttached({ timeout: 30_000 });
    await minus.focus();
    await page.keyboard.press("Tab");
    await expect(plus).toBeFocused();
    expect(await plus.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    expect(await plus.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  });
});

// The organiser's "Before you go" rows: "The essentials." in the main column, just before Location (the owner's reference).
for (const vp of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test.describe(`Before you go at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("Neon Static's rows are \"The essentials.\" before Location: numbered labels, right-aligned values, a rule under each", async ({ page }) => {
      await mockApi(page);
      await page.goto("/events/neon-static");
      const section = page.getByRole("region", { name: "The essentials." });
      await expect(section).toBeAttached({ timeout: 30_000 });
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading", { level: 2, name: "The essentials." })).toBeVisible();
      const rows = section.locator("[data-before-you-go-row]");
      await expect(rows).toHaveCount(3);
      // Shown uppercase (CSS), stored as typed; the number is decorative.
      await expect(section.locator("dt")).toHaveText(["01 / ENTRY", "02 / AGE", "03 / EXTRAS"], { useInnerText: true });
      await expect(section.locator("dd")).toHaveText(["7:30 pm – 10:30 pm", "18+ · Photo ID required", "Free earplugs at the bar"]);
      // The small-text orange (#d03e00, 4.8:1 on white), the full stop in Signal Orange, the value in the foreground.
      const look = await section.evaluate((el) => {
        const dt = el.querySelector("dt") as HTMLElement;
        const dd = el.querySelector("dd") as HTMLElement;
        const row = el.querySelector("[data-before-you-go-row]") as HTMLElement;
        const stop = el.querySelector("h2 span") as HTMLElement;
        return {
          label: getComputedStyle(dt).color,
          weight: getComputedStyle(dt).fontWeight,
          stop: getComputedStyle(stop).color,
          align: getComputedStyle(dd).textAlign,
          rule: getComputedStyle(row).borderBottomWidth,
          valueRight: Math.round(dd.getBoundingClientRect().right),
          sectionRight: Math.round(el.getBoundingClientRect().right),
        };
      });
      expect(look).toMatchObject({ label: "rgb(208, 62, 0)", weight: "700", stop: "rgb(255, 72, 0)", align: "right", rule: "1px" });
      expect(look.valueRight).toBe(look.sectionRight);
      // Each label and its value on one line at every width (Neon Static's are short).
      for (const i of [0, 1, 2]) {
        const [dt, dd] = await Promise.all([rows.nth(i).locator("dt").boundingBox(), rows.nth(i).locator("dd").boundingBox()]);
        if (!dt || !dd) throw new Error("row not laid out");
        expect(dd.y).toBeLessThan(dt.y + dt.height);
        expect(dt.y).toBeLessThan(dd.y + dd.height);
      }
      const sectionBottom = await section.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
      const locationTop = await page
        .getByRole("heading", { level: 2, name: "Location" })
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      expect(sectionBottom).toBeLessThan(locationTop);
      await noSidewaysScroll(page);
      if (process.env.EVENT_SHOTS) {
        await section.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: `${process.env.EVENT_SHOTS}/before-you-go-event-page-${vp.width}.png` });
      }
    });
  });
}
