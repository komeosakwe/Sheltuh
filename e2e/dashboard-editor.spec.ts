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
      for (const name of ["Start date", "Start time", "End date", "End time", "Days before the event"]) {
        const box = await page.getByLabel(name, { exact: true }).boundingBox();
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
    // The refund policy left as it was: the default.
    expect(created[0]).toMatchObject({ refundPolicy: "no_change_of_mind" });
    expect(created[0]).not.toHaveProperty("refundDays");
  });
});

test.describe("/dashboard/new: an event in Perth (owner plan S8)", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("the suburb gives the state and zone, the legends say Perth time, and the draft is sent with them", async ({ page }) => {
    const created: Record<string, unknown>[] = [];
    await signedInAsOrganiser(page, (request, path) => {
      const method = request.method();
      if (method === "POST" && path === "/api/events") {
        const body: Record<string, unknown> = request.postDataJSON();
        created.push(body);
        return { status: 201, json: { ...createdDraft(body), eventId: "evt-e2e-perth", state: body.state, timeZone: body.timeZone } };
      }
      if (method === "GET" && path === "/api/organisers/me/events/evt-e2e-perth") {
        return { json: { ...createdDraft(created[0] ?? {}), eventId: "evt-e2e-perth", state: "WA", timeZone: "Australia/Perth" } };
      }
      return null;
    });
    await page.goto("/dashboard/new");
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await expect(form.getByLabel("Title", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(form.getByText("Starts (local time)")).toBeVisible();

    await form.getByLabel("Title", { exact: true }).fill("Northbridge Late Sketch");
    await form.getByLabel("Description").fill("Life drawing with a jazz trio.");
    await form.getByLabel("Venue name").fill("James Street Studio");
    await form.getByLabel("Venue address").fill("40 James Street");
    const suburb = form.getByLabel("Suburb or town");
    await suburb.fill("Perth");
    // The place and its zone, and (a bare name, no state given) where else there's a Perth.
    const perthHint =
      "Perth, Western Australia · Perth time (AWST) Also in TAS. Add the state (“Perth, TAS”) or pick it from the list.";
    await expect(form.locator("#suburb-hint")).toHaveText(perthHint, { timeout: 30_000 });
    await expect(suburb).toHaveAccessibleDescription(perthHint);
    await expect(form.getByText("Starts (Perth time)")).toBeVisible();
    await expect(form.getByText("Ends (Perth time)")).toBeVisible();
    // Western Australia has two zones (Eucla's too): the choice is there, Perth's chosen.
    await expect(form.getByLabel("Time zone")).toHaveValue("Australia/Perth");
    // 44px targets, and nothing scrolls sideways at 375px.
    expect((await suburb.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await form.getByLabel("Time zone").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await form.getByLabel("Start date").fill("2027-03-06");
    await form.getByLabel("Start time").fill("18:30");
    await form.getByLabel("End date").fill("2027-03-06");
    await form.getByLabel("End time").fill("21:30");
    await form.getByLabel("Name", { exact: true }).fill("Drawing place");
    await form.getByLabel("Price (A$)").fill("30");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => created.length, { timeout: 30_000 }).toBe(1);
    expect(created[0]).toMatchObject({
      suburb: "Perth",
      state: "WA",
      timeZone: "Australia/Perth",
      start: { date: "2027-03-06", time: "18:30" },
      end: { date: "2027-03-06", time: "21:30" },
    });
    await expect(page).toHaveURL(/\/dashboard\/evt-e2e-perth$/, { timeout: 30_000 });
  });

  test("an unknown suburb is refused by the field, with a near spelling, and nothing is sent", async ({ page }) => {
    const created: unknown[] = [];
    await signedInAsOrganiser(page, (request, path) => {
      if (request.method() === "POST" && path === "/api/events") created.push(request.postDataJSON());
      return null;
    });
    await page.goto("/dashboard/new");
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await expect(form.getByLabel("Title", { exact: true })).toBeVisible({ timeout: 30_000 });
    const suburb = form.getByLabel("Suburb or town");
    await suburb.fill("Fremantel");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(form.locator("#suburb-error")).toHaveText(
      "We couldn’t find that suburb or town. Did you mean Fremantle, WA?",
      { timeout: 30_000 },
    );
    await expect(suburb).toHaveAttribute("aria-invalid", "true");
    // Its border is the danger colour (globals.css: the invalid rule as specific as the base input rule).
    const danger = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--danger)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    expect(await suburb.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(danger);
    expect(created).toEqual([]);

    // The near spelling is a button that fills the field in, and the error goes with the change.
    await form.getByRole("button", { name: "Use Fremantle, WA" }).click();
    await expect(suburb).toHaveValue("Fremantle, WA");
    await expect(suburb).toBeFocused();
    await expect(form.locator("#suburb-error")).toHaveCount(0);
    await expect(suburb).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.locator("#suburb-hint")).toHaveText("Fremantle, Western Australia · Perth time (AWST)");
  });
});

test.describe("/dashboard/[eventId]: refund policy at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("choosing days saves them; a refused tightening is shown by the policy, with focus there", async ({ page }) => {
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
      eventId: "evt-e2e-refunds",
      refundPolicy: "days_before",
      refundDays: 7,
    };
    const refusal =
      "This event already has orders, so its refund policy can only become more generous: people who bought tickets keep the refunds they were offered.";
    const saved: Record<string, unknown>[] = [];
    await signedInAsOrganiser(page, (request, path) => {
      const method = request.method();
      if (method === "GET" && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
      if (method === "PATCH" && path === `/api/events/${draft.eventId}`) {
        const body: Record<string, unknown> = request.postDataJSON();
        saved.push(body);
        // The first save loosens (allowed); the second tightens (refused).
        if (saved.length === 1) return { json: { ...draft, refundDays: body.refundDays } };
        return { status: 409, json: { error: refusal, code: "refund_policy_tightened", fieldErrors: { refundPolicy: refusal } } };
      }
      return null;
    });
    await page.goto(`/dashboard/${draft.eventId}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });

    const policy = form.getByRole("group", { name: "Refund policy" });
    const days = policy.getByLabel("Days before the event", { exact: true });
    const none = policy.getByRole("radio", { name: "No refunds for change of mind" });
    await expect(policy.getByRole("radio", { name: "Refunds up to a number of days before the event" })).toBeChecked();
    await expect(days).toHaveValue("7");
    await expect(policy).toContainText("Australian Consumer Law");
    // Each choice is a 44px target.
    for (const option of await policy.locator("label").filter({ has: page.getByRole("radio") }).all()) {
      expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await days.fill("3");
    // What buyers will see, dated from the start (Sat 6 Mar 2027, 8:00 pm), as it's typed.
    await expect(policy.locator("#refundDays-preview")).toContainText("(3 days before the event)");
    await form.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ refundPolicy: "days_before", refundDays: 3 });

    await none.check();
    // Never disabled: using it would choose days again.
    await expect(days).toBeEnabled();
    await form.getByRole("button", { name: "Save draft" }).click();
    await expect(policy.getByText(refusal)).toBeVisible();
    // The saved terms, and what they can become.
    await expect(policy).toContainText("It’s currently 3 days: choose 3 or fewer, or keep it.");
    await expect(none).toBeFocused();
    await expect(form.getByRole("alert")).toContainText("See Refund policy.");
    expect(saved[1]).toMatchObject({ refundPolicy: "no_change_of_mind" });
    expect(saved[1]).not.toHaveProperty("refundDays");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("/dashboard/[eventId]: paid tickets before payouts are set up", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("says so up front, keeps Publish… enabled, and a refused publish moves focus to the reason and its link", async ({
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
      location: CONFIRMED_PIN,
    };
    const refusal = "Set up payouts before publishing an event with paid tickets. Free events can be published now.";
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
        if (method === "POST" && path === `/api/events/${draft.eventId}/publish`) {
          calls.push("publish");
          return { status: 409, json: { error: refusal, code: "payouts_required" } };
        }
        return null;
      },
      { payoutsEnabled: false },
    );
    await page.goto(`/dashboard/${draft.eventId}`);
    const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });

    await expect(form.getByText(/^Set up payouts before you can publish this event\./)).toBeVisible();
    const submit = form.getByRole("button", { name: "Publish…" });
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAccessibleDescription(/can be published once your payouts are set up/);
    await expect(form.getByRole("button", { name: "Save draft" })).toBeEnabled();
    for (const link of await form.getByRole("link", { name: "Set up payouts" }).all()) {
      await expect(link).toHaveAttribute("href", "/dashboard/payouts");
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await submit.click();
    await form.getByRole("button", { name: "Publish now" }).click();
    // Named by the reason and focused, which announces it (no role="alert" too).
    const reason = form.getByRole("group", { name: refusal });
    await expect(reason).toBeVisible();
    // Focus is on the refusal (its container), so the link is the next stop.
    await expect(page.locator("[data-payouts-error]")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-payouts-error]").getByRole("link", { name: "Set up payouts" })).toBeFocused();
    await expect(submit).toHaveAccessibleDescription(new RegExp(refusal.slice(0, 30)));
    expect(calls).toEqual(["save", "publish"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

/** A saved venue pin in Collingwood: publishing needs one (`location_required` otherwise). */
const CONFIRMED_PIN = { source: "manual_pin", pin: { lat: -37.8, lng: 144.99 } };

/** A free draft for the publish tests (no payouts needed), its venue pinned unless `extra` says otherwise. */
function freeDraft(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    ...createdDraft({
      title: "Neon Static",
      description: "Four bands, one room.",
      category: "live-music",
      venueName: "The Tote",
      venueAddress: "71 Johnston St",
      suburb: "Collingwood",
      start: { date: "2027-03-06", time: "20:00" },
      end: { date: "2027-03-06", time: "23:30" },
      ticketTypes: [{ id: "ga", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 100 }],
    }),
    eventId,
    location: CONFIRMED_PIN,
    ...extra,
  };
}

/** The draft's editor, its save and publish answered by `publish` (with the saved draft). */
async function openDraftToPublish(
  page: Page,
  draft: ReturnType<typeof freeDraft>,
  publish: (draft: ReturnType<typeof freeDraft>) => { status?: number; json: unknown },
) {
  const calls: string[] = [];
  await signedInAsOrganiser(page, (request, path) => {
    const method = request.method();
    if (method === "GET" && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
    if (method === "PATCH" && path === `/api/events/${draft.eventId}`) {
      calls.push("save");
      return { json: draft };
    }
    if (method === "POST" && path === `/api/events/${draft.eventId}/publish`) {
      calls.push("publish");
      return publish(draft);
    }
    return null;
  });
  await page.goto(`/dashboard/${draft.eventId}`);
  const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });
  return { form, calls };
}

for (const vp of [
  { width: 375, height: 800 },
  { width: 1280, height: 900 },
]) {
  test.describe(`/dashboard/[eventId]: publishing at ${vp.width}px`, () => {
    test.use({ viewport: vp });

    test("Publish… asks first (Cancel focused, Escape closes), then it's live, with a link to its page", async ({ page }) => {
      const { form, calls } = await openDraftToPublish(page, freeDraft("evt-e2e-publish"), (draft) => ({
        json: { ...draft, status: "published", ticketingLocked: true },
      }));
      const open = form.getByRole("button", { name: "Publish…" });
      await open.click();
      const question = form.getByRole("group", { name: "Publish this event now?" });
      await expect(question).toContainText("Your followers are emailed about it. Emails can’t be unsent.");
      await expect(question.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
      expect(calls).toEqual([]);

      await open.click();
      for (const name of ["Publish now", "Cancel"]) {
        expect((await question.getByRole("button", { name }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await question.getByRole("button", { name: "Publish now" }).click();

      const outcome = page.getByRole("group", { name: "Published" });
      await expect(outcome).toBeFocused();
      await expect(outcome).toContainText("It’s live on Sheltüh now");
      await expect(outcome.getByRole("link", { name: "View your event page" })).toHaveAttribute("href", "/events/neon-static");
      await expect(page.getByRole("heading", { level: 1, name: "Your event" })).toBeVisible();
      await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
      expect(calls).toEqual(["save", "publish"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });

    test("sent for review instead: says so, and why when it's known (a seat map)", async ({ page }) => {
      const { form } = await openDraftToPublish(
        page,
        freeDraft("evt-e2e-seated-publish", { seating: { version: 1, seatCount: 40 } }),
        (draft) => ({ json: { ...draft, status: "pending_review" } }),
      );
      await form.getByRole("button", { name: "Publish…" }).click();
      const question = form.getByRole("group", { name: "Send this event for review?" });
      await expect(question).toContainText("Events with a seat map are checked by a person before they go live.");
      await question.getByRole("button", { name: "Send for review" }).click();
      const outcome = page.getByRole("group", { name: "Sent for review" });
      await expect(outcome).toBeFocused();
      await expect(outcome).toContainText("Events with a seat map are checked by a person before they go live.");
      await expect(page.getByRole("heading", { level: 1, name: "Your submission" })).toBeVisible();
    });

    test("refused because it changed meanwhile: says so, focused, with Reload page", async ({ page }) => {
      const { form } = await openDraftToPublish(page, freeDraft("evt-e2e-changed"), () => ({
        status: 409,
        json: { error: "Changed.", code: "event_changed" },
      }));
      await form.getByRole("button", { name: "Publish…" }).click();
      await form.getByRole("button", { name: "Publish now" }).click();
      const refusal = form.getByRole("group", { name: /ticket link changed while it was being published/ });
      await expect(refusal).toBeFocused();
      await expect(refusal.getByRole("button", { name: "Reload page" })).toBeVisible();
      await expect(form.getByRole("button", { name: "Publish…" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("/dashboard/[eventId]: unpublished by Sheltüh, at 375px", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("shows Sheltüh's note, and Send for review sends it with no question", async ({ page }) => {
    const unpublished = freeDraft("evt-e2e-unpublished", {
      ticketingLocked: true,
      rejectionReason: "The photo isn't of this event.",
      moderationLog: [
        { action: "approved", by: "u1", at: "2026-10-20T00:00:00.000Z" },
        { action: "unpublished", by: "sheltuh", at: "2026-10-21T00:00:00.000Z", reason: "The photo isn't of this event." },
      ],
    });
    const { form, calls } = await openDraftToPublish(page, unpublished, (draft) => ({
      json: { ...draft, status: "pending_review", rejectionReason: undefined },
    }));
    await expect(form.getByText("Taken off Sheltüh — note from Sheltüh:")).toBeVisible();
    await expect(form.getByText("The photo isn't of this event.")).toBeVisible();
    await expect(form.getByRole("button", { name: "Publish…" })).toHaveCount(0);
    await form.getByRole("button", { name: "Send for review" }).click();
    const outcome = page.getByRole("group", { name: "Sent for review" });
    await expect(outcome).toBeFocused();
    await expect(outcome).toContainText("Sheltüh took it off the site before");
    expect(calls).toEqual(["save", "publish"]);
  });
});

const TOTE_PLACE_ID = "ChIJtote00000000000000";

/**
 * The venue search (POST /api/places/autocomplete and /details, answered
 * here, never Google): The Tote. Records each body's `input` / `placeId`.
 */
function placesRoutes(log: string[]): (request: Request, path: string) => { status?: number; json: unknown } | null {
  return (request, path) => {
    if (request.method() !== "POST") return null;
    if (path === "/api/places/autocomplete") {
      log.push(`autocomplete:${(request.postDataJSON() as { input: string }).input}`);
      return {
        json: {
          suggestions: [
            { placeId: TOTE_PLACE_ID, primaryText: "The Tote Hotel", secondaryText: "71 Johnston St, Collingwood VIC" },
            { placeId: "ChIJtotebar0000000000", primaryText: "Tote Bar", secondaryText: "Smith St, Fitzroy VIC" },
          ],
        },
      };
    }
    if (path === "/api/places/details") {
      log.push(`details:${(request.postDataJSON() as { placeId: string }).placeId}`);
      return {
        json: {
          placeId: TOTE_PLACE_ID,
          formattedAddress: "71 Johnston St, Collingwood VIC 3066",
          streetAddress: "71 Johnston St",
          locality: "Collingwood",
          state: "VIC",
          postcode: "3066",
          googleMapsUrl: "https://maps.google.com/?cid=1",
        },
      };
    }
    return null;
  };
}

/** A pin: two numbers near Collingwood's centre (the ABS table's; Leaflet may round the last digit). */
function expectPinNearCollingwood(pin: unknown) {
  expect(pin).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
  const { lat, lng } = pin as { lat: number; lng: number };
  expect(Math.abs(lat + 37.8)).toBeLessThan(0.05);
  expect(Math.abs(lng - 144.99)).toBeLessThan(0.05);
}

for (const vp of [
  { width: 375, height: 800 },
  { width: 1280, height: 900 },
]) {
  test.describe(`/dashboard/[eventId]: the venue location at ${vp.width}px`, () => {
    test.use({ viewport: vp });
    const phone = vp.width < 640;

    test("find the venue on Google Maps, check the pin, save, and publish", async ({ page }) => {
      const draft = freeDraft("evt-e2e-places", { location: undefined });
      const saved: Record<string, unknown>[] = [];
      const places: string[] = [];
      const routes = placesRoutes(places);
      await signedInAsOrganiser(page, (request, path) => {
        const method = request.method();
        if (method === "GET" && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
        if (method === "PATCH" && path === `/api/events/${draft.eventId}`) {
          const body: Record<string, unknown> = request.postDataJSON();
          saved.push(body);
          return { json: { ...draft, location: body.location } };
        }
        if (method === "POST" && path === `/api/events/${draft.eventId}/publish`) {
          return { json: { ...draft, status: "published", ticketingLocked: true } };
        }
        return routes(request, path);
      });
      await page.goto(`/dashboard/${draft.eventId}`);
      const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
      await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });

      // No pin yet: Publish… says so, by the venue, which is focused; nothing is sent.
      await form.getByRole("button", { name: "Publish…" }).click();
      const venue = form.getByRole("group", { name: "Venue" });
      await expect(venue).toBeFocused();
      await expect(venue).toHaveAccessibleDescription("Add the venue location and confirm the pin first.");
      expect(saved).toEqual([]);

      const search = form.getByRole("combobox", { name: "Find the venue on Google Maps" });
      await search.fill("The Tote");
      const list = form.getByRole("listbox", { name: "Places on Google Maps" });
      await expect(list.getByRole("option")).toHaveCount(2);
      await expect(form.getByText("Powered by Google")).toBeVisible();
      expect(places).toEqual(["autocomplete:The Tote"]);
      expect((await list.getByRole("option").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await search.press("ArrowDown");
      await expect(search).toHaveAttribute("aria-activedescendant", /option-0$/);
      await search.press("Enter");

      await expect(form.getByText("Linked to Google Maps:")).toBeVisible();
      await expect(form.getByRole("link", { name: /^Check The Tote Hotel.*on Google Maps \(opens in a new tab\)$/ })).toHaveAttribute(
        "href",
        /query_place_id=ChIJtote00000000000000$/,
      );
      expect(places).toEqual(["autocomplete:The Tote", `details:${TOTE_PLACE_ID}`]);
      // The saved event's own fields stay as they were.
      await expect(form.getByLabel("Venue name")).toHaveValue("The Tote");
      await expect(form.getByRole("heading", { name: "Check the pin" })).toBeVisible();

      if (phone) {
        await expect(form.getByText(/^Not checked yet/)).toBeVisible();
        await form.getByRole("button", { name: "Check the pin" }).click();
        const dialog = page.getByRole("dialog", { name: /Check the pin/ });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "Done" }).click();
      } else {
        await expect(form.getByText(/^Not confirmed yet/)).toBeVisible();
        await expect(form.getByRole("application", { name: "Venue pin" })).toBeVisible();
        await form.getByRole("button", { name: "This is the right spot" }).click();
      }
      await expect(form.getByText(/Pin confirmed\./)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      await form.getByRole("button", { name: "Publish…" }).click();
      await form.getByRole("button", { name: "Publish now" }).click();
      await expect(page.getByRole("group", { name: "Published" })).toBeFocused();
      expect(saved).toHaveLength(1);
      const location = saved[0].location as { source: string; placeId: string; pin: unknown };
      expect(location).toMatchObject({ source: "places", placeId: TOTE_PLACE_ID });
      expectPinNearCollingwood(location.pin);
    });

    test("can't find it on Google Maps: drop a pin, and it's saved alone", async ({ page }) => {
      const draft = freeDraft("evt-e2e-manual-pin", { location: undefined });
      const saved: Record<string, unknown>[] = [];
      await signedInAsOrganiser(page, (request, path) => {
        const method = request.method();
        if (method === "GET" && path === `/api/organisers/me/events/${draft.eventId}`) return { json: draft };
        if (method === "PATCH" && path === `/api/events/${draft.eventId}`) {
          const body: Record<string, unknown> = request.postDataJSON();
          saved.push(body);
          return { json: { ...draft, location: body.location } };
        }
        return null;
      });
      await page.goto(`/dashboard/${draft.eventId}`);
      const form = page.locator("form").filter({ has: page.getByLabel("Title", { exact: true }) });
      await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Neon Static", { timeout: 30_000 });

      await form.getByRole("button", { name: "Can’t find it on Google Maps?" }).click();
      await expect(form.getByText(/^Not on Google Maps: put the pin on the venue below/)).toBeVisible();
      await expect(form.getByRole("combobox", { name: "Find the venue on Google Maps" })).toHaveCount(0);
      if (phone) {
        await form.getByRole("button", { name: "Check the pin" }).click();
        const dialog = page.getByRole("dialog", { name: /Check the pin/ });
        // The keyboard alternative to dragging: an arrow key moves the map.
        await dialog.getByRole("application", { name: "Venue pin" }).focus();
        await page.keyboard.press("ArrowRight");
        await dialog.getByRole("button", { name: "Done" }).click();
      } else {
        await form.getByRole("application", { name: "Venue pin" }).focus();
        await page.keyboard.press("ArrowRight");
        await form.getByRole("button", { name: "This is the right spot" }).click();
      }
      await expect(form.getByText(/Pin confirmed\./)).toBeVisible();
      await form.getByRole("button", { name: "Save draft" }).click();
      await expect.poll(() => saved.length, { timeout: 30_000 }).toBe(1);
      const location = saved[0].location as { source: string; pin: unknown };
      expect(location.source).toBe("manual_pin");
      expectPinNearCollingwood(location.pin);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  });
}
