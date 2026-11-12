// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { ApiError } from "@/lib/api/client";
import type { GoingAttendee, MyGoingStatus, ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The event page's Who's going row (the owner's event mock): the count, up to five faces, "Ticket
 * holders opt in", and I'm going or View attendees, all from WhosGoingProvider's one load (nothing invented).
 */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = {
  getGoingSummary: vi.fn(),
  getMyGoingStatus: vi.fn(),
  listGoingAttendees: vi.fn(),
  getMyProfile: vi.fn(),
};
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...args: unknown[]) => api.getGoingSummary(...args),
  getMyGoingStatus: (...args: unknown[]) => api.getMyGoingStatus(...args),
  listGoingAttendees: (...args: unknown[]) => api.listGoingAttendees(...args),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
}));
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => api.getMyProfile(...args),
  saveMyProfile: vi.fn(),
  deleteMyProfile: vi.fn(),
  // No photos load in jsdom: every face falls back to initials.
  fetchAvatar: () => Promise.reject(new Error("no photos in tests")),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  for (const fn of Object.values(api)) fn.mockReset();
});

const DEMO_EVENT = sampleEvents.find((e) => e.slug === "neon-static") as SheltuhEvent;
const LIVE_EVENT: SheltuhEvent = { ...DEMO_EVENT, id: "evt-live-1", organiserId: "org-1" };

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function people(n: number): GoingAttendee[] {
  return Array.from({ length: n }, (_, i) => ({
    attendeeId: `p-${i}`,
    displayName: `Person ${String.fromCharCode(65 + i)}.`,
    isYou: false,
  }));
}

function member({
  count,
  attendees,
  me = { going: false, eligible: false, hasProfile: true },
  profile = PROFILE,
}: {
  count: number;
  attendees: GoingAttendee[];
  me?: MyGoingStatus;
  profile?: ProfileRecord | null;
}) {
  api.getGoingSummary.mockResolvedValue({ count: count < 3 ? 0 : count, countHidden: count < 3, closed: false });
  api.getMyGoingStatus.mockResolvedValue(me);
  api.listGoingAttendees.mockResolvedValue({ items: attendees });
  if (profile) api.getMyProfile.mockResolvedValue(profile);
  else api.getMyProfile.mockRejectedValue(new ApiError(404, "No profile."));
}

function renderEvent(event: SheltuhEvent, auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <EventDetailsView event={event} demo={!event.organiserId} />
    </FakeAuthProvider>,
  );
}

const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined });

async function card() {
  return screen.findByRole("region", { name: "Who’s going?" });
}

describe("Who's going? card", () => {
  it("is a labelled section between the organiser and the ticket panel's actions, with View attendees to the panel", async () => {
    member({ count: 42, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    const region = await card();
    // The section's name for screen readers; the row itself leads with the count (the owner's event mock).
    expect(within(region).getByRole("heading", { level: 2, name: "Who’s going?" })).toHaveClass("sr-only");
    expect(region).toHaveTextContent("42 going");
    expect(region).toHaveTextContent("Ticket holders opt in");
    // Live: no "(sample)".
    expect(region).not.toHaveTextContent("sample");
    const view = within(region).getByRole("link", { name: `View attendees for ${LIVE_EVENT.title}` });
    expect(view).toHaveAttribute("href", "#whos-going");
    // The rules' Secondary button, 48px tall on phones.
    expect(view).toHaveClass("btn-outline", "max-md:min-h-12");
    // A cream panel, no photo.
    expect(region).toHaveClass("bg-hover");
    expect(region.querySelector("img")).toBeNull();

    // Reading order: the organiser, then this row, then Save and Share, then the tickets.
    const organiser = document.querySelector("[data-organiser-avatar]");
    const actions = document.querySelector("[data-event-actions]");
    const tickets = screen.getByRole("heading", { name: "Select your tickets" });
    if (!actions || !organiser) throw new Error("no actions row or organiser");
    expect(organiser.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.compareDocumentPosition(tickets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows up to five faces from the names already sent, and no +N", async () => {
    member({ count: 42, attendees: people(7) });
    renderEvent(LIVE_EVENT);
    const region = await card();
    await waitFor(() => expect(region.querySelectorAll("[data-going-face]")).toHaveLength(5));
    expect(region.querySelector("[data-going-rest]")).toBeNull();
  });

  it("puts the viewer first when they're going, and counts them among the faces", async () => {
    member({ count: 5, attendees: people(4), me: { going: true, eligible: true, hasProfile: true } });
    renderEvent(LIVE_EVENT);
    const region = await card();
    await waitFor(() => expect(region.querySelector("[data-going-faces]")).not.toBeNull());
    const faces = region.querySelector("[data-going-faces]");
    // "You" (initials, orange) plus the four others: five in all.
    expect(faces?.children).toHaveLength(5);
    expect(faces?.children[0]).toHaveTextContent("MT");
    // Already going: View attendees, not I'm going.
    expect(within(region).queryByRole("link", { name: "I’m going" })).toBeNull();
    expect(within(region).getByRole("link", { name: `View attendees for ${LIVE_EVENT.title}` })).toBeInTheDocument();
  });

  it("says I'm going to a ticket holder who can add themselves and hasn't, even under three going", async () => {
    member({ count: 2, attendees: people(1), me: { going: false, eligible: true, hasProfile: true } });
    renderEvent(LIVE_EVENT);
    const region = await card();
    const going = await within(region).findByRole("link", { name: "I’m going" });
    // To the panel, where the existing opt-in is.
    expect(going).toHaveAttribute("href", "#whos-going");
    // No number under three.
    expect(region.querySelector("[data-going-count]")).toBeNull();
    expect(region).toHaveTextContent("Ticket holders opt in");
  });

  it("isn't I'm going for someone without a ticket (View attendees), or for a suspended member", async () => {
    member({ count: 9, attendees: people(3), me: { going: false, eligible: false, hasProfile: true } });
    renderEvent(LIVE_EVENT);
    let region = await card();
    await waitFor(() => expect(within(region).getByRole("link", { name: `View attendees for ${LIVE_EVENT.title}` })).toBeInTheDocument());
    expect(within(region).queryByRole("link", { name: "I’m going" })).toBeNull();
    cleanup();

    member({ count: 9, attendees: people(3), me: { going: false, eligible: true, hasProfile: true }, profile: { ...PROFILE, suspended: true } });
    renderEvent(LIVE_EVENT);
    region = await card();
    expect(within(region).queryByRole("link", { name: "I’m going" })).toBeNull();
  });

  it("links a face to the member's profile only when they made it visible", async () => {
    const attendees: GoingAttendee[] = [
      { attendeeId: "a", displayName: "Ana K.", isYou: false, profileId: "prof-ana", hasAvatar: false },
      { attendeeId: "b", displayName: "Ben L.", isYou: false },
      { attendeeId: "c", displayName: "Cy M.", isYou: false },
    ];
    member({ count: 3, attendees });
    renderEvent(LIVE_EVENT);
    const region = await card();
    const profile = await within(region).findByRole("link", { name: "Ana K.’s profile" });
    expect(profile).toHaveAttribute("href", "/members/prof-ana");
    // The others are decorative.
    expect(within(region).getAllByRole("link")).toHaveLength(2);
  });

  it("signed out: the count only, no faces and no +N (the API sends no names)", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 14, countHidden: false, closed: false });
    renderEvent(LIVE_EVENT, signedOut());
    const region = await card();
    expect(region).toHaveTextContent("14 going");
    expect(region.querySelector("[data-going-faces]")).toBeNull();
    expect(region.querySelector("[data-going-rest]")).toBeNull();
    expect(within(region).getByRole("link", { name: `View attendees for ${LIVE_EVENT.title}` })).toBeInTheDocument();
  });

  it("is hidden under three going, while loading, on a load error and once closed (as the panel keeps its own states)", async () => {
    member({ count: 2, attendees: people(2) });
    renderEvent(LIVE_EVENT);
    await waitFor(() => expect(api.listGoingAttendees).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Who’s going?" })).toBeNull();
    cleanup();

    renderEvent(LIVE_EVENT, fakeAuthValue({ status: "loading", email: undefined }));
    expect(screen.queryByRole("region", { name: "Who’s going?" })).toBeNull();
    cleanup();

    api.getGoingSummary.mockReset();
    api.getGoingSummary.mockRejectedValue(new ApiError(500, "boom"));
    renderEvent(LIVE_EVENT, signedOut());
    await screen.findByText("Couldn't load who's going.", { selector: "div" });
    expect(screen.queryByRole("region", { name: "Who’s going?" })).toBeNull();
    cleanup();

    api.getGoingSummary.mockReset();
    api.getGoingSummary.mockResolvedValue({ count: 0, countHidden: false, closed: true });
    renderEvent(LIVE_EVENT, signedOut());
    await waitFor(() => expect(document.getElementById("whos-going")).toBeNull());
    expect(screen.queryByRole("region", { name: "Who’s going?" })).toBeNull();
  });

  it("demo: the sample count, labelled, with the sample names' faces and no API call", async () => {
    renderEvent(DEMO_EVENT, signedOut());
    const sample = getSampleGoing(DEMO_EVENT.id);
    const region = await card();
    expect(region).toHaveTextContent(`${sample.count} going (sample)`);
    expect(region.querySelectorAll("[data-going-face]")).toHaveLength(5);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("isn't on an external event (no Who's Going there)", async () => {
    const external = sampleEvents.find((e) => e.ticketingMode === "external");
    if (!external) throw new Error("no external sample");
    renderEvent(external, signedOut());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Who’s going?" })).toBeNull();
  });
});
