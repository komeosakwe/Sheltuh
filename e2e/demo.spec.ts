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
  });
}
