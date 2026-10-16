// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserProfilePage from "@/app/organisers/[organiserId]/page";
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

afterEach(cleanup);
beforeEach(() => {
  apiConfigured = true;
  getOrganiserProfile.mockReset();
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
      ["Facebook: northsidenoise (opens in a new tab)", "https://www.facebook.com/northsidenoise"],
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
    expect(within(upcoming).getByRole("link", { name: /Event soon/ })).toHaveAttribute("href", "/events/soon");
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

  it("shows other errors, and loads again on 'Try again'", async () => {
    getOrganiserProfile
      .mockRejectedValueOnce(new ApiError(500, "Something went wrong."))
      .mockResolvedValueOnce(profile());
    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading organiser");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Northside Noise" })).toBeInTheDocument();
    expect(getOrganiserProfile).toHaveBeenCalledTimes(2);
  });
});

describe("/organisers/[organiserId] (demo)", () => {
  it("explains organiser profiles aren't available, without calling the API", async () => {
    apiConfigured = false;
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "This organiser isn’t available" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Demo");
    expect(screen.getByRole("link", { name: "Browse all events" })).toHaveAttribute("href", "/events");
    expect(getOrganiserProfile).not.toHaveBeenCalled();
  });
});
