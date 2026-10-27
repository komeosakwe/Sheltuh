import { expect, test, type Page } from "@playwright/test";
import { sampleEvents } from "@/lib/sample-events";
import { getSampleGoing } from "@/lib/sample-going";

/**
 * The demo as the Vercel preview runs it (playwright.config.ts, "demo"
 * project: a production build with no Supabase env). Every page is built
 * from the sample data: organiser and member names link to sample profiles,
 * and a sample member can be messaged in the page. Nothing may call the
 * app's API, so any /api/* request fails the test.
 */

/** Fails the test on any request to the app's own API. */
function noApiCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${request.method()} ${url.pathname}`);
  });
  return () => expect(calls).toEqual([]);
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { width: 375, height: 740 },
  { width: 1280, height: 800 },
]) {
  test.describe(`demo at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("an event's organiser name opens the sample organiser's page, with their events", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      await page.goto("/events/dead-letter-office");
      const link = page.getByRole("link", { name: "Small Hours Theatre", exact: true });
      await expect(link).toBeVisible({ timeout: 60_000 });
      await link.click();

      await expect(page).toHaveURL(/\/organisers\/small-hours-theatre$/);
      await expect(page.getByRole("heading", { level: 1, name: "Small Hours Theatre" })).toBeVisible();
      await expect(page).toHaveTitle("Small Hours Theatre — Sheltüh");
      // Upcoming or past, depending on the day the suite runs: it's on the page either way.
      const eventLink = page.getByRole("link", { name: /Dead Letter Office/ }).first();
      await expect(eventLink).toHaveAttribute("href", "/events/dead-letter-office");
      await eventLink.scrollIntoViewIfNeeded();
      await expect(eventLink).toBeVisible();
      // Follow is shown, but only as unavailable in the demo.
      await expect(page.getByRole("button", { name: "Follow Small Hours Theatre" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await expect(page.getByText("Following works once you’re signed in on the live site.")).toBeVisible();
      await noSidewaysScroll(page);
      checkNoApiCalls();
    });

    test("a Who's Going name opens their profile; Message opens a conversation where a sent message appears", async ({
      page,
    }) => {
      const checkNoApiCalls = noApiCalls(page);
      // A sample event that hasn't ended (its list closes once it has, as in live: V4), with a sample
      // member among the six names shown before "Show more". The samples have fixed dates, so pick one
      // that's still a day away rather than a fixed slug.
      const firstMember = (eventId: string) => getSampleGoing(eventId).attendees.slice(0, 6).find((a) => a.profileId);
      const event = sampleEvents.find(
        (e) =>
          e.ticketingMode !== "external" &&
          Date.parse(e.endsAt ?? e.startsAt) > Date.now() + 24 * 3600_000 &&
          firstMember(e.id) !== undefined,
      );
      if (!event) throw new Error("no upcoming sample event with a sample member in its first six names");
      const member = firstMember(event.id);
      if (!member?.profileId) throw new Error("no sample member in the first six names");

      await page.goto(`/events/${event.slug}`);
      // The panel opens on a preview; the names are behind "See who's going" (mobile-redesign.md §6.4.2).
      const seeWho = page.getByRole("button", { name: "See who’s going" });
      await expect(seeWho).toHaveAttribute("aria-expanded", "false", { timeout: 60_000 });
      await seeWho.click();
      await expect(seeWho).toHaveAttribute("aria-expanded", "true");
      const names = page.getByRole("list", { name: "People going" });
      await expect(names).toBeVisible({ timeout: 60_000 });
      await names.getByRole("link", { name: member.displayName }).click();

      await expect(page).toHaveURL(new RegExp(`/members/${member.profileId}$`));
      await expect(page.getByRole("heading", { level: 1, name: member.displayName })).toBeVisible();
      await expect(page.getByText("A fictional member, made up for this demo.")).toBeVisible();
      await noSidewaysScroll(page);
      await page.getByRole("link", { name: "Message" }).click();

      await expect(page).toHaveURL(new RegExp(`/messages/${member.profileId}$`));
      await expect(page.getByRole("heading", { level: 1, name: member.displayName })).toBeVisible();
      const box = page.getByRole("textbox", { name: `Message ${member.displayName}` });
      await box.fill("See you at the front!");
      await page.getByRole("button", { name: "Send" }).click();

      const thread = page.getByRole("list", { name: `Messages with ${member.displayName}` });
      await expect(thread.getByRole("listitem").last()).toContainText("See you at the front!");
      await expect(box).toHaveValue("");
      await expect(box).toBeFocused();
      await noSidewaysScroll(page);
      checkNoApiCalls();
    });

    // Refinement (owner, 22 Oct 2026): one clear sample-data disclosure per page (the slim banner at the
    // top), plus the existing non-booking notices where you'd book; no repeated bulky notices.
    test("one sample-data banner per page, and the non-booking notices at the booking points", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      await page.goto("/");
      await expect(page.locator("[data-home-section]").first()).toBeVisible({ timeout: 60_000 });
      const banner = page.locator("[data-demo-banner]");
      await expect(banner).toHaveCount(1);
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("No real bookings.");
      // Directly under the header, inside main, and the page's only demo note.
      expect(await banner.evaluate((el) => el.parentElement?.id)).toBe("main");
      await expect(page.locator("main [role='note']")).toHaveCount(1);
      // Demo counts on cards stay labelled.
      await expect(page.locator("[data-event-card] [data-card-secondary]").filter({ hasText: /going/ }).first()).toContainText("(sample)");

      const now = Date.now();
      const event = sampleEvents.find(
        (e) =>
          (e.ticketingMode ?? "sheltuh") === "sheltuh" &&
          !e.seating &&
          !e.soldOut &&
          e.ticketTypes.some((t) => t.priceCents > 0) &&
          Date.parse(e.startsAt) > now,
      );
      test.skip(!event, "no upcoming paid sample event left to check");
      if (!event) return;
      await page.goto(`/events/${event.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("[data-demo-banner]")).toHaveCount(1);
      await expect(page.getByText(/fictional sample data/)).toHaveCount(0);
      // The booking points still say nothing is booked here.
      await expect(page.locator("#tickets")).toContainText(/Checkout unavailable in this demo/i);
      await expect(page.getByRole("region", { name: "Who's going" }).getByRole("note")).toContainText("These names are samples.");
      await noSidewaysScroll(page);
      checkNoApiCalls();
    });

    test("Add to calendar's Apple link is the event's .ics, served inline as text/calendar", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      await page.goto("/events/thornbury-dub-session");
      const trigger = page.getByRole("button", { name: "Add to calendar" });
      await expect(trigger).toBeVisible({ timeout: 60_000 });
      await trigger.click();
      const apple = page.getByRole("link", { name: "Apple Calendar" });
      await expect(apple).toHaveAttribute("href", "/events/thornbury-dub-session/calendar.ics");
      expect(await apple.getAttribute("download")).toBeNull();

      const href = await apple.getAttribute("href");
      const res = await page.request.get(href ?? "");
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
      expect(res.headers()["content-disposition"]).toBe('inline; filename="thornbury-dub-session.ics"');
      expect(res.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=300");
      const ics = await res.text();
      expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
      expect(ics).toContain("UID:evt-thornbury-dub-session@sheltuh.com.au\r\n");
      expect(ics).toContain("DTSTART:20261107T083000Z\r\n");

      const missing = await page.request.get("/events/never-existed/calendar.ics");
      expect(missing.status()).toBe(404);
      checkNoApiCalls();
    });

    test("/checkout/pay says checkout isn't available in the demo, and never loads Stripe.js", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      const stripeRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).hostname.endsWith("stripe.com")) stripeRequests.push(request.url());
      });
      // Answered here if it were ever asked for, so a request can't hang the test.
      await page.route("https://js.stripe.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
      await page.goto(`/checkout/pay?order=ord_${"0".repeat(32)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Checkout isn’t available in this demo" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/");
      // Not even a preconnect to Stripe.js.
      await expect(page.locator('link[href*="stripe.com"]')).toHaveCount(0);
      await noSidewaysScroll(page);
      await page.waitForLoadState("networkidle");
      expect(stripeRequests).toEqual([]);
      checkNoApiCalls();
    });

    test("the inbox lists the sample conversations, each opening its thread", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      await page.goto("/messages");
      const conversations = page.getByRole("list", { name: "Conversations" });
      await expect(conversations.getByRole("listitem")).toHaveCount(3, { timeout: 60_000 });
      await conversations.getByRole("link", { name: /Priya R\./ }).click();
      await expect(page).toHaveURL(/\/messages\/priya-r$/);
      await expect(page.getByRole("list", { name: "Messages with Priya R." }).getByRole("listitem")).toHaveCount(3);
      await noSidewaysScroll(page);
      checkNoApiCalls();
    });

    test("sign in and sign up offer no Apple or Google buttons (no accounts in the demo)", async ({ page }) => {
      const checkNoApiCalls = noApiCalls(page);
      for (const path of ["/login", "/signup"]) {
        await page.goto(path);
        await expect(page.getByText("Accounts aren’t configured in this environment yet.")).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("button", { name: /Continue with (Apple|Google)/ })).toHaveCount(0);
        await expect(page.locator('img[src^="/auth/"]')).toHaveCount(0);
        await noSidewaysScroll(page);
      }
      checkNoApiCalls();
    });
  });
}
