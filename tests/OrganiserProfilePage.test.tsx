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

async function renderPage(organiserId = ORGANISER_ID) {
  render(
    await OrganiserProfilePage({
      params: Promise.resolve({ organiserId }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe("/organisers/[organiserId] (live)", () => {
  it("shows the organiser's name, join month, categories and bio, with one h1", async () => {
    getOrganiserProfile.mockResolvedValue(profile());
    await renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Northside Noise" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(getOrganiserProfile).toHaveBeenCalledWith(ORGANISER_ID);
    expect(screen.getByText("Member since March 2026")).toBeInTheDocument();
    const categories = screen.getByRole("list", { name: "Categories" });
    expect(within(categories).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Live music", "Pop-up"]);
    expect(screen.getByText(/Loud nights in small rooms\./)).toBeInTheDocument();
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
    // The card's own link (its name starts with the title); its quick buy is a separate link to the tickets.
    expect(within(upcoming).getByRole("link", { name: /^Event soon/ })).toHaveAttribute("href", "/events/soon");
    expect(within(upcoming).getByRole("link", { name: /tickets for Event soon$/ })).toHaveAttribute(
      "href",
      "/events/soon#tickets",
    );
    expect(within(upcoming).queryByRole("link", { name: /^By / })).not.toBeInTheDocument();

    const past = screen.getByRole("heading", { level: 2, name: "Past events" }).closest("section");
    if (!past) throw new Error("past section not rendered");
    const pastLink = within(past).getByRole("link", { name: /Event gone/ });
    expect(pastLink).toHaveAttribute("href", "/events/gone");
    expect(pastLink).toHaveTextContent("2025"); // a past date carries its year
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
    expect(screen.getByText("Events hosted").nextElementSibling).toHaveTextContent("0");
    expect(getOrganiserProfile).not.toHaveBeenCalled();
  });

  it("lists an organiser's ended sample events as past, counted as hosted", async () => {
    await renderPage("static-collective");

    expect(screen.getByRole("heading", { level: 1, name: "Static Collective" })).toBeInTheDocument();
    expect(screen.getByText("Member since September 2026")).toBeInTheDocument();
    expect(screen.getByText("No upcoming events right now.", { exact: false })).toBeInTheDocument();
    const past = screen.getByRole("heading", { level: 2, name: "Past events" }).closest("section");
    if (!past) throw new Error("past section not rendered");
    expect(within(past).getByRole("link", { name: /Neon Static/ })).toHaveAttribute("href", "/events/neon-static");
    expect(screen.getByText("Events hosted").nextElementSibling).toHaveTextContent("1");
  });

  it("offers Follow only as unavailable, with a note, and makes no follow request", async () => {
    await renderPage("small-hours-theatre");

    const follow = screen.getByRole("button", { name: "Follow Small Hours Theatre" });
    expect(follow).toHaveAttribute("aria-disabled", "true");
    expect(follow).toHaveAccessibleDescription(/Following works once you’re signed in on the live site\./);
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
    const metadata = await generateMetadata({
      params: Promise.resolve({ organiserId }),
      searchParams: Promise.resolve({}),
    });
    return metadata.title;
  }

  it("live: the plain title (LiveOrganiserProfile names the organiser once loaded)", async () => {
    expect(await title(ORGANISER_ID)).toBe("Organiser — Sheltüh");
  });

  it("demo: the sample organiser's name, or not available for an unknown id", async () => {
    apiConfigured = false;
    expect(await title("small-hours-theatre")).toBe("Small Hours Theatre — Sheltüh");
    expect(await title("no-such-organiser")).toBe("Organiser not available — Sheltüh");
  });
});
