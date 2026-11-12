// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/lib/api/public-events";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/** /community in live mode: the public events API (mocked), every page of it, and nothing invented. */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listPublicEvents = vi.fn();
vi.mock("@/lib/api/public-events", () => ({ listPublicEvents: (...args: unknown[]) => listPublicEvents(...args) }));
// A few suburbs in place of the suburb table (events without a pin are placed by their suburb's centre).
const loadLocation = vi.fn();
vi.mock("@/lib/location-loader", async () => {
  const stub = (await import("./test-utils/locationStub")).locationLoaderStub();
  // Not loaded yet: the page loads it only when an event has no pin.
  return { ...stub, loadLocation: () => loadLocation(), loadedLocation: () => null };
});

const { default: CommunityPage } = await import("@/components/community/CommunityPage");
const { COMMUNITY_LOAD_ERROR } = await import("@/components/community/LocalDiscovery");
const { COMMUNITY_MAX_PAGES, COMMUNITY_PAGE_LIMIT } = await import("@/lib/community");
const realLoader = (await import("./test-utils/locationStub")).locationLoaderStub();

const NOW = new Date("2026-10-21T01:00:00.000Z");

function item(id: string, suburb: string, state?: "WA", startsAt = "2026-11-01T08:00:00.000Z"): PublicEvent {
  return {
    organiserId: "org",
    eventId: id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    venueName: "Venue",
    venueAddress: "1 St",
    suburb,
    ...(state ? { state } : {}),
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  listPublicEvents.mockReset();
  loadLocation.mockReset().mockImplementation(() => realLoader.loadLocation());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.clear();
});

async function renderPage() {
  const utils = render(
    <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined })}>
      <CommunityPage />
    </FakeAuthProvider>,
  );
  for (let i = 0; i < 4; i += 1) await act(() => new Promise((r) => setTimeout(r, 0)));
  return utils;
}

const cityLink = (name: string) => document.querySelector<HTMLElement>(`[data-city='${name}']`) as HTMLElement;

describe("/community (live)", () => {
  it("reads every page of upcoming events, places those without a pin by their suburb, and shows the real counts", async () => {
    listPublicEvents
      .mockResolvedValueOnce({ items: [item("a", "Fitzroy"), item("b", "Collingwood")], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [item("c", "Perth", "WA")], nextCursor: undefined });
    await renderPage();
    expect(listPublicEvents).toHaveBeenNthCalledWith(1, { upcoming: true, limit: COMMUNITY_PAGE_LIMIT, cursor: undefined });
    expect(listPublicEvents).toHaveBeenNthCalledWith(2, { upcoming: true, limit: COMMUNITY_PAGE_LIMIT, cursor: "c1" });
    expect(loadLocation).toHaveBeenCalled();
    expect(cityLink("Melbourne")).toHaveTextContent("Art · 2 upcoming");
    expect(cityLink("Perth")).toHaveTextContent("Art · 1 upcoming");
    expect(cityLink("Sydney")).toHaveTextContent("No upcoming events");
    const local = screen.getByRole("list", { name: "Local discovery" });
    expect(within(local).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Event a", "Event b", "Event c"]);
    // Choosing a city stores the suburb table's own name and state for it, as the location menu does.
    fireEvent.click(cityLink("Perth"));
    expect(JSON.parse(localStorage.getItem("sheltuh:near:v1") ?? "{}")).toEqual({ suburb: "Perth", state: "WA" });
  });

  it("never states a count it can't vouch for: with pages left unread, the cities show without counts", async () => {
    listPublicEvents.mockResolvedValue({ items: [item("a", "Fitzroy")], nextCursor: "more" });
    await renderPage();
    expect(listPublicEvents).toHaveBeenCalledTimes(COMMUNITY_MAX_PAGES);
    expect(cityLink("Melbourne")).toHaveTextContent("Art");
    for (const name of ["Melbourne", "Sydney", "Brisbane", "Perth", "Adelaide"]) expect(cityLink(name)).not.toHaveTextContent(/upcoming/);
  });

  it("when the suburb table can't load: no counts, and says so", async () => {
    listPublicEvents.mockResolvedValue({ items: [item("a", "Fitzroy")], nextCursor: undefined });
    loadLocation.mockReset().mockRejectedValue(new Error("offline"));
    await renderPage();
    expect(cityLink("Melbourne")).not.toHaveTextContent(/upcoming/);
    expect(screen.getByText("Event counts aren’t available right now.")).toBeInTheDocument();
  });

  it("on failure: the error with Try again where the events would be; the rest of the page still shows", async () => {
    listPublicEvents.mockRejectedValueOnce(new Error("down"));
    await renderPage();
    const local = screen.getByRole("region", { name: "Local discovery" });
    expect(within(local).getByRole("alert")).toHaveTextContent(COMMUNITY_LOAD_ERROR);
    expect(screen.getByRole("region", { name: "Scenes by city" })).toBeInTheDocument();
    expect(cityLink("Melbourne")).not.toHaveTextContent(/upcoming/);
    listPublicEvents.mockResolvedValueOnce({ items: [item("a", "Fitzroy")], nextCursor: undefined });
    fireEvent.click(within(local).getByRole("button", { name: "Try again" }));
    for (let i = 0; i < 4; i += 1) await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(within(local).queryByRole("alert")).toBeNull();
    expect(within(local).getByRole("heading", { level: 3, name: "Event a" })).toBeInTheDocument();
  });

  it("says 'Email or Google · 1 min' under Join only where Google sign-in is on and Apple isn't", async () => {
    listPublicEvents.mockResolvedValue({ items: [], nextCursor: undefined });
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google");
    await renderPage();
    expect(screen.getByRole("region", { name: "Your people are already here." })).toHaveTextContent("Email or Google · 1 min");
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
    await renderPage();
    expect(screen.getByRole("region", { name: "Your people are already here." })).not.toHaveTextContent(/Email or Google/);
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    await renderPage();
    expect(screen.getByRole("region", { name: "Your people are already here." })).not.toHaveTextContent(/Email or Google/);
    // Nothing upcoming: Local discovery says so.
    expect(within(screen.getByRole("region", { name: "Local discovery" })).getByText("No events yet.")).toBeInTheDocument();
  });
});
