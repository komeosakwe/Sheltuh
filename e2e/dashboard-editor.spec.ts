import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * The organiser's event editor (/dashboard/new) at phone and desktop widths:
 * nothing overflows, and every field fits its column (brand-direction-one.md
 * §6.2). Live mode, signed in with a stored test session (no network: the
 * Supabase URL is a local placeholder), with every /api/* request answered here.
 */

const DAY = 86_400_000;

/** Requests to the app's API that no test answered, by method and path (beyond the organiser's own). */
type ExtraRoute = (request: Request, path: string) => { status?: number; json: unknown } | null;

/** `organiser`: fields of GET /api/organisers/me to change (payoutsEnabled, say). */
async function signedInAsOrganiser(page: Page, extra: ExtraRoute = () => null, organiser: Record<string, unknown> = {}) {
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
  // The storage key supabase-js derives from the placeholder URL (http://127.0.0.1:…/supabase-mock).
  await page.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  await page.route("**/supabase-mock/**", (route) => route.fulfill({ status: 200, json: {} }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
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
          ...organiser,
        },
      });
    }
    if (path === "/api/profiles/me") return route.fulfill({ json: { displayName: "Mia T.", suspended: false } });
    if (path === "/api/conversations/unread") return route.fulfill({ json: { count: 0 } });
    if (path.startsWith("/api/favourites")) return route.fulfill({ json: { items: [], ids: [] } });
    const answer = extra(route.request(), path);
    if (answer) return route.fulfill({ status: answer.status ?? 200, json: answer.json });
    return route.fulfill({ status: 404, json: { error: "not mocked in e2e" } });
  });
}

for (const vp of [
  { width: 320, height: 640 },
  { width: 1440, height: 900 },
]) {
  test.describe(`/dashboard/new at ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("no sideways scrolling, and every field fits inside the form", async ({ page }) => {
      await signedInAsOrganiser(page);
      await page.goto("/dashboard/new");
      const title = page.getByLabel("Title", { exact: true });
      await expect(title).toBeVisible({ timeout: 30_000 });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const formBox = await page.locator("form").filter({ has: title }).boundingBox();
      expect(formBox).not.toBeNull();
      for (const name of ["Start date", "Start time", "End date", "End time"]) {
        const box = await page.getByLabel(name).boundingBox();
        expect(box, name).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual((formBox?.x ?? 0) + (formBox?.width ?? 0) + 1);
        expect(box?.x ?? -1, name).toBeGreaterThanOrEqual((formBox?.x ?? 0) - 1);
      }
      // The photo picker is a button-styled label, not the browser's raw file control.
      await expect(page.getByText("Choose a photo")).toBeVisible();
    });
  });
}

/** The draft as the API answers a POST /events: the input back, with its id, as a draft. */
function createdDraft(input: Record<string, unknown>) {
  const now = new Date().toISOString();
  const melbourne = (part: { date: string; time: string }) => new Date(`${part.date}T${part.time}:00+11:00`).toISOString();
  return {
    organiserId: "org-demo",
    eventId: "evt-e2e-seated",
    slug: "neon-static",
    title: input.title,
    description: input.description,
    category: input.category,
    venueName: input.venueName,
    venueAddress: input.venueAddress,
    suburb: input.suburb,
    startsAt: melbourne(input.start as { date: string; time: string }),
    endsAt: melbourne(input.end as { date: string; time: string }),
    organiserName: "Northside Noise",
    ticketTypes: input.ticketTypes,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: false,
    status: "draft",
    moderationLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

test.describe("/dashboard/new with reserved seating", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("choosing Reserved seating saves the draft, then lands on its seat map", async ({ page }) => {
    let draft: ReturnType<typeof createdDraft> | null = null;
    const created: unknown[] = [];
    await signedInAsOrganiser(page, (request, path) => {
      const method = request.method();
      if (method === "POST" && path === "/api/events") {
        const body: Record<string, unknown> = request.postDataJSON();
        created.push(body);
        draft = createdDraft(body);
        return { status: 201, json: draft };
      }
      if (method === "GET" && draft && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
      // No map yet: the editor starts empty.
      if (method === "GET" && draft && path === `/api/events/${draft.eventId}/seat-map`) {
        return { status: 404, json: { error: "This event has no seat map." } };
      }
      return null;
    });
    await page.goto("/dashboard/new");
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible({ timeout: 30_000 });

    const seating = page.getByRole("group", { name: "Seating" });
    await expect(seating.getByRole("radio", { name: "General admission (no assigned seats)" })).toBeChecked();
    const reservedName = "Reserved seating (buyers pick seats on a map)";
    const reserved = seating.getByRole("radio", { name: reservedName });
    // The whole choice is the target (at least 44px tall), not just the radio.
    const option = seating.locator("label").filter({ has: page.getByRole("radio", { name: reservedName }) });
    const box = await option.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await option.click();
    await expect(reserved).toBeChecked();
    await expect(seating.getByText(/The seat map is set up next/)).toBeVisible();
    // Still no sideways scrolling at 320px with the note open.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // The page header has its own location search (with a "Suburb" field): fill the editor's.
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await form.getByLabel("Title", { exact: true }).fill("Neon Static");
    await form.getByLabel("Description").fill("Four bands, one room.");
    await form.getByLabel("Venue name").fill("The Tote");
    await form.getByLabel("Venue address").fill("71 Johnston St");
    await form.getByLabel("Suburb").fill("Collingwood");
    await form.getByLabel("Start date").fill("2027-03-06");
    await form.getByLabel("Start time").fill("20:00");
    await form.getByLabel("End date").fill("2027-03-06");
    await form.getByLabel("End time").fill("23:30");
    await form.getByLabel("Name", { exact: true }).fill("Stalls");
    await form.getByLabel("Price (A$)").fill("35");

    await page.getByRole("button", { name: "Save draft and set up seats" }).click();
    await expect(page).toHaveURL(/\/dashboard\/evt-e2e-seated\/seat-map$/, { timeout: 30_000 });
    // The seat-map page has loaded the new draft.
    await expect(page.getByRole("heading", { level: 1, name: "Seat map" })).toBeVisible({ timeout: 30_000 });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ title: "Neon Static", ticketTypes: [{ name: "Stalls", priceCents: 3500 }] });
    expect(created[0]).not.toHaveProperty("seating");
  });
});

test.describe("/dashboard/[eventId]: paid tickets before payouts are set up", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("says so up front, keeps Submit enabled, and a refused submit moves focus to the reason and its link", async ({
    page,
  }) => {
    const draft = {
      ...createdDraft({
        title: "Neon Static",
        description: "Four bands, one room.",
        category: "live-music",
        venueName: "The Tote",
        venueAddress: "71 Johnston St",
        suburb: "Collingwood",
        start: { date: "2027-03-06", time: "20:00" },
        end: { date: "2027-03-06", time: "23:30" },
        ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 }],
      }),
      eventId: "evt-e2e-paid",
    };
    const refusal = "Set up payouts before submitting an event with paid tickets. Free events can be submitted now.";
    const calls: string[] = [];
    await signedInAsOrganiser(
      page,
      (request, path) => {
        const method = request.method();
        if (method === "GET" && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
        if (method === "PATCH" && path === `/api/events/${draft.eventId}`) {
          calls.push("save");
          return { json: draft };
        }
        if (method === "POST" && path === `/api/events/${draft.eventId}/submit`) {
          calls.push("submit");
          return { status: 409, json: { error: refusal, code: "payouts_required" } };
        }
        return null;
      },
      { payoutsEnabled: false },
    );
    await page.goto(`/dashboard/${draft.eventId}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });

    await expect(form.getByText(/^Set up payouts before you can submit this event\./)).toBeVisible();
    const submit = form.getByRole("button", { name: "Submit for review" });
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAccessibleDescription(/can be submitted once your payouts are set up/);
    await expect(form.getByRole("button", { name: "Save draft" })).toBeEnabled();
    for (const link of await form.getByRole("link", { name: "Set up payouts" }).all()) {
      await expect(link).toHaveAttribute("href", "/dashboard/payouts");
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await submit.click();
    const reason = form.getByRole("alert").filter({ hasText: refusal });
    await expect(reason).toBeVisible();
    // Focus is on the refusal (its container), so the link is the next stop.
    await expect(page.locator("[data-payouts-error]")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-payouts-error]").getByRole("link", { name: "Set up payouts" })).toBeFocused();
    await expect(submit).toHaveAccessibleDescription(new RegExp(refusal.slice(0, 30)));
    expect(calls).toEqual(["save", "submit"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
