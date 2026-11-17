// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserProfilePage, { generateMetadata } from "@/app/organisers/[organiserId]/page";
import { ApiError } from "@/lib/api/client";
import type { PublicEvent } from "@/lib/api/public-events";
import type { PublicOrganiserProfile } from "@/lib/api/types";

// Live by default; the demo test flips it.
let apiConfigured = true;
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return apiConfigured;
  },
}));
const getOrganiserProfile = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  getOrganiserProfile: (...args: unknown[]) => getOrganiserProfile(...args),
}));
// No server deps (no DATABASE_URL etc.), as in a test run: the live metadata read fails.
vi.mock("@/lib/server/deps", () => ({
  getDeps: () => {
    throw new Error("Missing required environment variable: DATABASE_URL");
  },
}));
// Any follow request at all (the demo must make none).
const followApi = vi.fn();
vi.mock("@/lib/api/follows", () => ({
  getFollowStatus: (...args: unknown[]) => followApi(...args),
  followOrganiser: (...args: unknown[]) => followApi(...args),
  unfollowOrganiser: (...args: unknown[]) => followApi(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  apiConfigured = true;
  getOrganiserProfile.mockReset();
  followApi.mockReset();
});

const ORGANISER_ID = "8c4f6f8e-0d5b-4a51-9a3e-2f6f0b0d1a11";

function publicEvent(slug: string, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    organiserId: ORGANISER_ID,
    eventId: `id-${slug}`,
    slug,
    title: `Event ${slug}`,
    description: "d",
    category: "live-music",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    startsAt: "2026-11-20T09:00:00.000Z",
    endsAt: "2026-11-20T12:00:00.000Z",
    organiserName: "Northside Noise",
    ticketTypes: [{ id: "t1", name: "GA", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

function profile(overrides: Partial<PublicOrganiserProfile> = {}): PublicOrganiserProfile {
  return {
    organiserId: ORGANISER_ID,
    displayName: "Northside Noise",
    description: "Loud nights in small rooms.\nAll ages where we can.",
    categories: ["live-music", "pop-up"],
    profileTags: ["live-music", "pop-ups-markets"],
    customTags: ["Late-night"],
    websiteUrl: "https://www.northside.example/about?ref=x",
    socialLinks: {
      instagram: "https://www.instagram.com/northside.noise/",
      tiktok: "https://www.tiktok.com/@northside_noise",
      facebook: "https://www.facebook.com/northsidenoise",
      x: "https://x.com/nsnoise",
    },
    memberSince: "2026-03",
    upcomingEvents: [publicEvent("soon"), publicEvent("later")],
    recentEvents: [publicEvent("gone", { startsAt: "2025-08-01T09:00:00.000Z", endsAt: "2025-08-01T12:00:00.000Z" })],
    ...overrides,
  };
}

/** A promise the test settles itself. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderTree(organiserId = ORGANISER_ID) {
  return OrganiserProfilePage({
    params: Promise.resolve({ organiserId }),
    searchParams: Promise.resolve({}),
  });
}

async function renderPage(organiserId = ORGANISER_ID) {
  render(await renderTree(organiserId));
}

describe("/organisers/[organiserId] (live)", () => {
  it("shows the organiser's name, join month, chips and bio, with one h1", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Northside Noise" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(getOrganiserProfile).toHaveBeenCalledWith(ORGANISER_ID);
    expect(screen.getByText("Member since March 2026")).toBeInTheDocument();
    const categories = screen.getByRole("list", { name: "Categories" });
    // The list's chips (as labels, in list order), then their own words.
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Live music",
      "Pop-ups & markets",
      "Late-night",
    ]);
    expect(screen.getByText(/Loud nights in small rooms\./)).toBeInTheDocument();
  });

  it("falls back to the reviewed categories for a profile sent without chips, and has no chips list when they chose none", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ profileTags: undefined, customTags: undefined }));
    await renderPage();
    const categories = await screen.findByRole("list", { name: "Categories" });
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Live music",
      "Pop-ups & markets",
    ]);
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile({ profileTags: [], customTags: [] }));
    await renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("list", { name: "Categories" })).toBeNull();
  });

  it("shows the cover (decorative) above the header, and no cover frame without one", async () => {
    getOrganiserProfile.mockResolvedValue(
      profile({
        coverUrl: `/api/organisers/${ORGANISER_ID}/cover?v=7`,
        coverSmallUrl: `/api/organisers/${ORGANISER_ID}/cover?size=small&v=7`,
      }),
    );
    const { container } = render(await renderTree());
    const heading = await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    const cover = container.querySelector("[data-organiser-cover]");
    if (!cover) throw new Error("cover not rendered");
    const img = cover.querySelector("img");
    expect(img).toHaveAttribute("src", `/api/organisers/${ORGANISER_ID}/cover?v=7`);
    expect(img).toHaveAttribute(
      "srcset",
      `/api/organisers/${ORGANISER_ID}/cover?size=small&v=7 1120w, /api/organisers/${ORGANISER_ID}/cover?v=7 2240w`,
    );
    expect(img).toHaveAttribute("alt", "");
    // Before the header in the DOM, as on screen; nothing is written on it.
    expect(cover.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cover.textContent).toBe("");
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile());
    const second = render(await renderTree());
    await screen.findByRole("heading", { level: 1 });
    expect(second.container.querySelector("[data-organiser-cover]")).toBeNull();
  });

  it("keeps the cover's frame, empty, when the image fails", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ coverUrl: `/api/organisers/${ORGANISER_ID}/cover?v=7` }));
    const { container } = render(await renderTree());
    await screen.findByRole("heading", { level: 1 });
    const img = container.querySelector("[data-organiser-cover] img");
    if (!img) throw new Error("cover not rendered");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    const frame = container.querySelector("[data-organiser-cover]");
    expect(frame).not.toBeNull();
    expect(frame?.querySelector("img")).toBeNull();
    expect(frame).toHaveClass("aspect-7/2", "min-h-44", "bg-surface");
  });

  it("lays the logo over the cover's corner when there's a cover, and in the flow without one", async () => {
    const logoUrl = `/api/organisers/${ORGANISER_ID}/logo?v=42`;
    getOrganiserProfile.mockResolvedValue(profile({ logoUrl, coverUrl: `/api/organisers/${ORGANISER_ID}/cover?v=7` }));
    const { container } = render(await renderTree());
    await screen.findByRole("heading", { level: 1 });
    const slot = container.querySelector("[data-organiser-logo-slot]");
    expect(slot).toHaveClass("-mt-12", "sm:-mt-16", "xl:-mt-20", "relative", "z-10");
    expect(container.querySelector("[data-organiser-logo]")).toHaveClass("ring-4", "ring-background", "xl:size-40");
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile({ logoUrl }));
    const second = render(await renderTree());
    await screen.findByRole("heading", { level: 1 });
    expect(second.container.querySelector("[data-organiser-logo-slot]")).not.toHaveClass("-mt-12");
  });

  it("states its facts on one line: events (hidden at 0), followers (only when sent), member since", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ eventCount: 1240, followerCount: 12 }));
    await renderPage();
    const member = await screen.findByText("Member since March 2026");
    const facts = member.closest("ul");
    if (!facts) throw new Error("facts not rendered");
    expect([...facts.children].map((li) => li.textContent)).toEqual([
      "1,240 events",
      "12 followers",
      "Member since March 2026",
    ]);
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile({ eventCount: 1, followerCount: null }));
    await renderPage();
    const one = (await screen.findByText("Member since March 2026")).closest("ul");
    expect([...(one?.children ?? [])].map((li) => li.textContent)).toEqual(["1 event", "Member since March 2026"]);
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile({ eventCount: 0 }));
    await renderPage();
    const none = (await screen.findByText("Member since March 2026")).closest("ul");
    expect([...(none?.children ?? [])].map((li) => li.textContent)).toEqual(["Member since March 2026"]);
  });

  it("lists the social links first (Instagram first) and the website last", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();
    const links = (await screen.findByRole("heading", { level: 2, name: "Links" })).closest("section");
    if (!links) throw new Error("links not rendered");
    expect(within(links).getAllByRole("link").map((a) => a.getAttribute("aria-label")?.replace(/(: .*)? \(opens in a new tab\)$/, ""))).toEqual([
      "Instagram",
      "TikTok",
      "Facebook",
      "X",
      "Website",
    ]);
  });

  it("lists at most 12 past events, as rows of date, title and place", async () => {
    const recentEvents = Array.from({ length: 14 }, (_, i) =>
      publicEvent(`past-${i}`, { startsAt: "2025-08-01T09:00:00.000Z", endsAt: "2025-08-01T12:00:00.000Z" }),
    );
    getOrganiserProfile.mockResolvedValue(profile({ recentEvents }));
    await renderPage();
    const past = (await screen.findByRole("heading", { level: 2, name: "Past events" })).closest("section");
    if (!past) throw new Error("past section not rendered");
    const rows = within(past).getAllByRole("listitem");
    expect(rows).toHaveLength(12);
    const [date, title, place] = [...rows[0].children];
    expect(date.tagName).toBe("TIME");
    expect(date).toHaveAttribute("datetime", "2025-08-01T09:00:00.000Z");
    expect(title).toHaveAttribute("href", "/events/past-0");
    expect(place).toHaveTextContent("The Tote · Collingwood");
  });

  it("offers a report email naming the organiser and their profile, the whole subject encoded", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ displayName: "Salt & Pepper? Nights" }));
    await renderPage();
    const report = await screen.findByRole("link", { name: "Report this organiser" });
    const href = report.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:support@sheltuh.com.au?subject=")).toBe(true);
    const query = href.slice(href.indexOf("?") + 1);
    expect([...new URLSearchParams(query).keys()]).toEqual(["subject"]);
    expect(new URLSearchParams(query).get("subject")).toMatch(
      new RegExp(`^Report: Salt & Pepper\\? Nights \\((https?://[^/]+)?/organisers/${ORGANISER_ID}\\)$`),
    );
  });

  it("shows the organiser's logo (decorative) above the strap and name when they have one", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ logoUrl: `/api/organisers/${ORGANISER_ID}/logo?v=42` }));
    const { container } = render(await renderTree());
    const heading = await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    const logo = container.querySelector("[data-organiser-logo]");
    if (!logo) throw new Error("logo not rendered");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo.querySelector("img")).toHaveAttribute("src", `/api/organisers/${ORGANISER_ID}/logo?v=42`);
    expect(logo.querySelector("img")).toHaveAttribute("alt", "");
    // Above the strap and name, in the header, at the profile's sizes.
    expect(logo.closest("header")).toContainElement(heading);
    expect(logo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(logo).toHaveClass("size-24", "sm:size-32", "xl:size-40");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("leaves the logo out when it fails to load, and has none without a logoUrl", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ logoUrl: `/api/organisers/${ORGANISER_ID}/logo?v=42` }));
    const { container } = render(await renderTree());
    await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    const img = container.querySelector("[data-organiser-logo] img");
    if (!img) throw new Error("logo not rendered");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("[data-organiser-logo]")).toBeNull();
    expect(screen.queryByText("NN")).toBeNull(); // no initials stand-in
    cleanup();

    getOrganiserProfile.mockResolvedValue(profile());
    const second = render(await renderTree());
    await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    expect(second.container.querySelector("[data-organiser-logo]")).toBeNull();
    expect(second.container.querySelector("header img")).toBeNull();
  });

  it("links the website by hostname only, in a new tab, as nofollow user content", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();

    const website = await screen.findByRole("link", { name: "Website: northside.example (opens in a new tab)" });
    expect(website).toHaveAttribute("href", "https://www.northside.example/about?ref=x");
    expect(website).toHaveAttribute("target", "_blank");
    expect(website).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(website).not.toHaveTextContent("/about");
  });

  it("names each social link by network and handle, opening in a new tab", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();

    const expected: [string, string][] = [
      ["Instagram: @northside.noise (opens in a new tab)", "https://www.instagram.com/northside.noise/"],
      ["TikTok: @northside_noise (opens in a new tab)", "https://www.tiktok.com/@northside_noise"],
      ["Facebook: facebook.com/northsidenoise (opens in a new tab)", "https://www.facebook.com/northsidenoise"],
      ["X: @nsnoise (opens in a new tab)", "https://x.com/nsnoise"],
    ];
    await screen.findByRole("heading", { level: 1 });
    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("shows only the links the organiser has set, and no links section without any", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ websiteUrl: undefined, socialLinks: { x: "https://x.com/nsnoise" } }));
    await renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: /^X: @nsnoise/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Website/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Instagram/ })).not.toBeInTheDocument();

    cleanup();
    getOrganiserProfile.mockResolvedValue(profile({ websiteUrl: undefined, socialLinks: {} }));
    await renderPage();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: "Links" })).not.toBeInTheDocument();
  });

  it("lists upcoming events as tiles (without a link back to this organiser) and past events quietly", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();

    const upcoming = (await screen.findByRole("heading", { level: 2, name: "Upcoming events" })).closest("section");
    if (!upcoming) throw new Error("upcoming section not rendered");
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Event soon",
      "Event later",
    ]);
    // The card's one link (named by the title); the redesign's card has no ticket button and no "By {organiser}".
    expect(within(upcoming).getByRole("link", { name: /^Event soon/ })).toHaveAttribute("href", "/events/soon");
    expect(within(upcoming).queryByRole("link", { name: /tickets for Event soon$/ })).not.toBeInTheDocument();
    expect(within(upcoming).queryByRole("link", { name: /^By / })).not.toBeInTheDocument();

    const past = screen.getByRole("heading", { level: 2, name: "Past events" }).closest("section");
    if (!past) throw new Error("past section not rendered");
    const pastLink = within(past).getByRole("link", { name: "Event gone" });
    expect(pastLink).toHaveAttribute("href", "/events/gone");
    // A past date carries its year.
    expect(pastLink.closest("li")?.querySelector("time")).toHaveTextContent("2025");
  });

  // V3 (visual QA, 22 Oct 2026): the old section header drew a mono strap repeating each h2. The
  // site's one section head says the title once, after a black rule.
  it("heads each events section once: no strap repeating 'Upcoming events' or 'Past events'", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();
    for (const name of ["Upcoming events", "Past events"]) {
      const heading = await screen.findByRole("heading", { level: 2, name });
      const section = heading.closest("section");
      if (!section) throw new Error(`${name} section not rendered`);
      expect(screen.getAllByText(name)).toHaveLength(1);
      expect(section.querySelector(".eyebrow")?.textContent ?? "").not.toContain(name);
      // The #organiser-upcoming target (a link to their upcoming events) is the heading itself.
      if (name === "Upcoming events") expect(heading).toHaveAttribute("id", "organiser-upcoming");
    }
  });

  it("says when there are no upcoming events, and leaves out past events when there are none", async () => {
    getOrganiserProfile.mockResolvedValue(profile({ upcomingEvents: [], recentEvents: [] }));
    await renderPage();

    expect(await screen.findByText(/No upcoming events right now\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all events" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("heading", { name: "Past events" })).not.toBeInTheDocument();
  });

  it("shows 'This organiser isn't available' with a way back on a 404", async () => {
    getOrganiserProfile.mockRejectedValue(new ApiError(404, "Organiser not found."));
    await renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "This organiser isn’t available" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all events" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows other errors, and loads again on 'Try again', focusing the loaded profile's heading", async () => {
    const firstLoad = deferred<never>();
    getOrganiserProfile.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce(profile());
    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading organiser");
    // Fail inside act() so the error state settles (render and effects) before the click: see
    // "focuses the error heading again when a retry fails too".
    await act(async () => firstLoad.reject(new ApiError(429, "Too many requests. Try again shortly.")));
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests. Try again shortly.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    // The button is gone: focus goes to the new heading, not <body>.
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(getOrganiserProfile).toHaveBeenCalledTimes(2);
  });

  it("focuses the 'isn't available' heading when a retry finds no organiser", async () => {
    getOrganiserProfile
      .mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server. Check your connection and try again."))
      .mockRejectedValueOnce(new ApiError(404, "Organiser not found."));
    // Settle the first failure before the click: see "focuses the error heading again when a retry fails too".
    await act(async () => {
      await renderPage();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "This organiser isn’t available" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("focuses the error heading again when a retry fails too", async () => {
    getOrganiserProfile.mockRejectedValue(new ApiError(0, "Couldn't reach the server."));
    // Let the first failure settle completely (its render *and* its effects) before clicking, as
    // a person would. Settled outside act(), React leaves that render's effects for a later task,
    // and under load the click could land first: the stale focus effect then consumed the
    // "focus after retry" flag on the old heading, so the retry's heading was never focused.
    await act(async () => {
      await renderPage();
    });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getOrganiserProfile).toHaveBeenCalledTimes(2));
    // Re-query on every attempt: the first error heading is replaced while the retry loads.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Couldn’t load this organiser" })).toHaveFocus(),
    );
  });

  it("doesn't move focus on the first load (only after 'Try again')", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();
    const heading = await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    expect(heading).not.toHaveFocus();
  });

  it.each([
    ["a 5xx with the server's message", new ApiError(500, "Internal error: relation does not exist")],
    ["a response with no JSON message", new ApiError(502, "Request failed (502).")],
    ["a non-JSON 4xx", new ApiError(403, "Request failed (403).")],
    ["something that isn't an API error", new TypeError("Cannot read properties of undefined")],
  ])("says something friendly for %s", async (_, error) => {
    getOrganiserProfile.mockRejectedValue(error);
    await renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong on our side. Try again in a moment.");
    expect(alert).not.toHaveTextContent(/\d{3}|relation|undefined/);
  });

  it("titles the page with the organiser's name once loaded", async () => {
    document.title = "Organiser — Sheltüh";
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();
    await screen.findByRole("heading", { level: 1, name: "Northside Noise" });
    await waitFor(() => expect(document.title).toBe("Northside Noise — Sheltüh"));
  });

  it("titles a missing organiser as unavailable, and an error with the plain page title", async () => {
    document.title = "Someone Else — Sheltüh";
    getOrganiserProfile.mockRejectedValue(new ApiError(404, "Organiser not found."));
    await renderPage();
    await screen.findByRole("heading", { level: 1, name: "This organiser isn’t available" });
    await waitFor(() => expect(document.title).toBe("Organiser not available — Sheltüh"));

    cleanup();
    document.title = "Someone Else — Sheltüh";
    getOrganiserProfile.mockRejectedValue(new ApiError(500, "boom"));
    await renderPage();
    await screen.findByRole("alert");
    expect(document.title).toBe("Organiser — Sheltüh");
  });

  it("marks each new-tab link with a visible (decorative) arrow", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();
    const link = await screen.findByRole("link", { name: "X: @nsnoise (opens in a new tab)" });
    const icons = link.querySelectorAll("svg");
    // The network's mark and the new-tab arrow, both hidden from the accessibility tree.
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("/organisers/[organiserId] (demo)", () => {
  // Only Date is faked (so promises and testing-library's timers run as usual): 1 Oct 2026, Melbourne.
  beforeEach(() => {
    apiConfigured = false;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a sample organiser's profile, built from their sample events, without calling the API", async () => {
    await renderPage("small-hours-theatre");

    expect(screen.getByRole("heading", { level: 1, name: "Small Hours Theatre" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Member since October 2026")).toBeInTheDocument();
    expect(screen.getByText(/Small Hours Theatre is a fictional organiser, made up for this demo\./)).toBeInTheDocument();
    const categories = screen.getByRole("list", { name: "Categories" });
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Theatre"]);
    // A made-up website on the reserved .example domain.
    expect(screen.getByRole("link", { name: /^Website: smallhourstheatre\.example/ })).toHaveAttribute(
      "href",
      "https://smallhourstheatre.example",
    );

    const upcoming = screen.getByRole("heading", { level: 2, name: "Upcoming events" }).closest("section");
    if (!upcoming) throw new Error("upcoming section not rendered");
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Dead Letter Office",
    ]);
    expect(within(upcoming).getByRole("link", { name: /^Dead Letter Office/ })).toHaveAttribute(
      "href",
      "/events/dead-letter-office",
    );
    expect(screen.queryByRole("heading", { level: 2, name: "Past events" })).not.toBeInTheDocument();
    // The demo has no logos, and this organiser no cover: the header is just the strap and name.
    expect(document.querySelector("[data-organiser-logo]")).toBeNull();
    expect(document.querySelector("[data-organiser-cover]")).toBeNull();
    expect(document.querySelector("header img")).toBeNull();
    expect(getOrganiserProfile).not.toHaveBeenCalled();
  });

  it("lists an organiser's ended sample events as past, with their cover, chips and event count", async () => {
    await renderPage("static-collective");

    expect(screen.getByRole("heading", { level: 1, name: "Static Collective" })).toBeInTheDocument();
    expect(screen.getByText("Member since September 2026")).toBeInTheDocument();
    expect(screen.getByText("No upcoming events right now.", { exact: false })).toBeInTheDocument();
    const past = screen.getByRole("heading", { level: 2, name: "Past events" }).closest("section");
    if (!past) throw new Error("past section not rendered");
    expect(within(past).getByRole("link", { name: /Neon Static/ })).toHaveAttribute("href", "/events/neon-static");
    const facts = screen.getByText("Member since September 2026").closest("ul");
    expect(facts?.firstElementChild).toHaveTextContent("1 event");
    // A sample photo as the cover (no small variant, so no srcset), and made-up own words after the list's chips.
    const cover = document.querySelector("[data-organiser-cover] img");
    expect(cover).toHaveAttribute("src", "/events/dj-crate-digging.jpg");
    expect(cover).not.toHaveAttribute("srcset");
    const categories = screen.getByRole("list", { name: "Categories" });
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Live music",
      "Late-night",
      "Analogue synths",
    ]);
    // Share and Report work in the demo.
    expect(screen.getByRole("button", { name: "Share Static Collective" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Report this organiser" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:support@sheltuh\.com\.au\?subject=Report%3A%20Static%20Collective%20/),
    );
  });

  it("offers Follow only as unavailable, with a note, and makes no follow request", async () => {
    await renderPage("small-hours-theatre");

    const follow = screen.getByRole("button", { name: "Follow Small Hours Theatre" });
    expect(follow).toHaveAttribute("aria-disabled", "true");
    expect(follow).toHaveAccessibleDescription(/Not available in this demo\./);
    fireEvent.click(follow);
    expect(screen.queryByRole("link", { name: "Sign in to follow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(followApi).not.toHaveBeenCalled();
  });

  it("an unknown id: the demo's unavailable state, without calling the API", async () => {
    await renderPage("no-such-organiser");

    expect(screen.getByRole("heading", { level: 1, name: "This organiser isn’t available" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demo");
    expect(screen.getByRole("note")).toHaveTextContent("This demo only has the organisers of its sample events.");
    expect(screen.getByRole("link", { name: "Browse all events" })).toHaveAttribute("href", "/events");
    expect(getOrganiserProfile).not.toHaveBeenCalled();
  });
});

describe("/organisers/[organiserId] title", () => {
  async function title(organiserId: string) {
    const metadata = await generateMetadata({ params: Promise.resolve({ organiserId }), searchParams: Promise.resolve({}) });
    return metadata.title;
  }

  it("live, when the server can't read the organiser: the plain title (LiveOrganiserProfile names them once loaded)", async () => {
    // No database configured in this test: generic metadata, not an error.
    // The database-backed metadata is covered in tests/server/share-metadata.test.ts.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await title(ORGANISER_ID)).toBe("Organiser — Sheltüh");
    expect(error).toHaveBeenCalledWith("Organiser metadata unavailable:", expect.any(String));
    error.mockRestore();
  });

  it("demo: the sample organiser's name, or not available for an unknown id", async () => {
    apiConfigured = false;
    expect(await title("small-hours-theatre")).toBe("Small Hours Theatre — Sheltüh");
    expect(await title("no-such-organiser")).toBe("Organiser not available — Sheltüh");
  });
});
