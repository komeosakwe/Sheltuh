// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
 * Who's Going's compact preview and its "See who's going" disclosure
 * (docs/design/mobile-redesign.md §6.4.2, §6.4.3). The rest of the panel's
 * behaviour is in tests/WhosGoing.test.tsx.
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
  fetchAvatar: vi.fn(),
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
  fetchAvatar: (...args: unknown[]) => api.fetchAvatar(...args),
}));

beforeEach(() => {
  // The sample events are dated Sept–Nov 2026, and an ended demo event's Who's Going is closed (V4) and
  // has no buy bar (A7): read them before they end, whatever the real clock says. Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchAvatar.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

function summary(count: number) {
  const countHidden = count < 3;
  return { count: countHidden ? 0 : count, closed: false, countHidden };
}

function member({
  count,
  attendees,
  me = { going: false, eligible: false, hasProfile: false },
  profile = null,
}: {
  count: number;
  attendees: GoingAttendee[];
  me?: MyGoingStatus;
  profile?: ProfileRecord | null;
}) {
  api.getGoingSummary.mockResolvedValue(summary(count));
  api.getMyGoingStatus.mockResolvedValue(me);
  api.listGoingAttendees.mockResolvedValue({ items: attendees });
  if (profile) api.getMyProfile.mockResolvedValue(profile);
  else api.getMyProfile.mockRejectedValue(new ApiError(404, "No profile."));
}

const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined });

function renderEvent(event: SheltuhEvent, auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <EventDetailsView event={event} demo={!event.organiserId} />
    </FakeAuthProvider>,
  );
}

async function panel() {
  const region = await screen.findByRole("region", { name: "Who's going" });
  await waitFor(() => expect(region.closest("#whos-going")).not.toHaveAttribute("aria-busy"));
  return region;
}

const toggle = (region: HTMLElement) => within(region).queryByRole("button", { name: "See who’s going" });
const faces = (region: HTMLElement) => region.querySelector<HTMLElement>("[data-going-faces]");
const list = (region: HTMLElement) => within(region).queryByRole("list", { name: "People going" });

describe("Who's Going preview: collapsed by default", () => {
  it("demo: up to five sample faces and the count, then See who's going, which opens and closes the list", async () => {
    renderEvent(DEMO_EVENT, signedOut());
    const region = await panel();
    const sample = getSampleGoing(DEMO_EVENT.id);

    // The preview: five faces (decorative), the count, no list yet.
    const preview = faces(region);
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview?.children).toHaveLength(5);
    expect(within(region).getByText(String(sample.count))).toHaveClass("text-2xl");
    expect(list(region)).toBeNull();

    const button = toggle(region);
    if (!button) throw new Error("no See who's going");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");
    expect(button).toHaveClass("min-h-11");
    expect(region.closest("#whos-going")).not.toHaveAttribute("data-wg-expanded");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "wg-list");
    const opened = list(region);
    expect(opened?.closest("#wg-list")).not.toBeNull();
    expect(within(opened as HTMLElement).getAllByRole("listitem")).toHaveLength(6);
    // Open: the desktop aside unsticks, so a tall list can't hide the tickets.
    expect(region.closest("#whos-going")).toHaveAttribute("data-wg-expanded");
    // Focus stays on the toggle.
    button.focus();
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    expect(within(list(region) as HTMLElement).getAllByRole("listitem")).toHaveLength(Math.min(18, sample.count));

    // Closing keeps what's loaded: re-opening shows the same rows.
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(list(region)).toBeNull();
    fireEvent.click(button);
    expect(within(list(region) as HTMLElement).getAllByRole("listitem")).toHaveLength(Math.min(18, sample.count));
  });

  it("live, signed in: re-opening doesn't fetch again", async () => {
    member({ count: 5, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const button = toggle(region) as HTMLElement;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(list(region)).not.toBeNull();
    expect(api.listGoingAttendees).toHaveBeenCalledTimes(1);
  });
});

describe("Who's Going preview: only real, permitted data (§6.4.3)", () => {
  it("signed out: the count only; no faces, no names, no toggle (names are for members)", async () => {
    api.getGoingSummary.mockResolvedValue(summary(14));
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(within(region).getByText("14").closest("p")).toHaveTextContent("14 going");
    expect(faces(region)).toBeNull();
    expect(toggle(region)).toBeNull();
    expect(api.listGoingAttendees).not.toHaveBeenCalled();
  });

  it("signed out, under three: no number and no faces anywhere", async () => {
    api.getGoingSummary.mockResolvedValue(summary(2));
    const { container } = renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(faces(region)).toBeNull();
    expect(container.querySelector("[data-going-face]")).toBeNull();
    expect(region).not.toHaveTextContent(/\d going/);
  });

  it("signed in, one or two people: their faces but no number, and See who's going", async () => {
    member({ count: 2, attendees: people(2) });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(faces(region)?.children).toHaveLength(2);
    expect(region).not.toHaveTextContent(/\d going/);
    expect(toggle(region)).toBeInTheDocument();
  });

  // A5 (accessibility review, 22 Oct 2026): the faces are aria-hidden, and with fewer than three
  // there's no count beside them, so a screen reader heard nothing. It now hears the same names.
  it("signed in, one or two people: screen readers get who the faces are (the names already sent), never a number", async () => {
    member({ count: 2, attendees: people(2) });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const said = within(region).getByText("Going: Person A. and Person B.");
    expect(said).toHaveClass("sr-only");
    expect(said.closest("[aria-hidden='true']")).toBeNull();
    expect(said).not.toHaveTextContent(/\d/);
  });

  it("the viewer alone: 'Going: you.'; with a count shown there's no extra line (the count says it)", async () => {
    const you: GoingAttendee = { attendeeId: "me", displayName: "Mia T.", isYou: true };
    member({ count: 1, attendees: [you], me: { going: true, eligible: true, hasProfile: true }, profile: PROFILE });
    renderEvent(LIVE_EVENT);
    let region = await panel();
    expect(within(region).getByText("Going: you.")).toHaveClass("sr-only");
    cleanup();

    member({ count: 5, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    region = await panel();
    expect(within(region).queryByText(/^Going: /)).toBeNull();
  });

  it("overlaps the faces by 4px, so two-letter initials stay readable (A4)", async () => {
    member({ count: 5, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const [first, ...rest] = Array.from(faces(region)?.children ?? []);
    expect(first).not.toHaveClass("-ml-1");
    for (const face of rest) {
      expect(face).toHaveClass("-ml-1");
      expect(face).not.toHaveClass("-ml-2");
    }
  });

  it("signed in, nobody: no faces, no toggle, and says so", async () => {
    member({ count: 0, attendees: [] });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(faces(region)).toBeNull();
    expect(toggle(region)).toBeNull();
    expect(within(region).getByText("No one yet.")).toBeInTheDocument();
  });

  it("never more faces than names loaded, whatever the count: five at most", async () => {
    member({ count: 40, attendees: people(3) });
    renderEvent(LIVE_EVENT);
    let region = await panel();
    expect(faces(region)?.children).toHaveLength(3);
    cleanup();

    member({ count: 40, attendees: people(12) });
    renderEvent(LIVE_EVENT);
    region = await panel();
    expect(faces(region)?.children).toHaveLength(5);
  });

  it("the viewer, when going, is the first face (orange 'you'), then four others", async () => {
    const you: GoingAttendee = { attendeeId: "me", displayName: "Mia T.", isYou: true };
    member({
      count: 8,
      attendees: [you, ...people(7)],
      me: { going: true, eligible: true, hasProfile: true },
      profile: PROFILE,
    });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const preview = faces(region);
    expect(preview?.children).toHaveLength(5);
    expect(preview?.firstElementChild?.querySelector(".bg-signal")).toHaveTextContent("MT");
  });

  it("a photo only for a member with a visible profile and a photo (fetched with the token); initials otherwise", async () => {
    member({
      count: 3,
      attendees: [
        { attendeeId: "a", displayName: "Ana P.", isYou: false, profileId: "prof-a", hasAvatar: true, avatarThumbUrl: "/api/profiles/prof-a/avatar?size=96" },
        // A photo URL with no visible profile is never used.
        { attendeeId: "b", displayName: "Ben Q.", isYou: false, hasAvatar: true, avatarThumbUrl: "/api/x" },
        { attendeeId: "c", displayName: "Cy R.", isYou: false, profileId: "prof-c", hasAvatar: false },
      ],
    });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const preview = faces(region) as HTMLElement;
    await waitFor(() => expect(preview.querySelectorAll("img[data-member-photo]")).toHaveLength(1));
    expect(preview.querySelector("img")).toHaveAttribute("src", "blob:photo");
    expect(preview.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(preview).getByText("BQ")).toBeInTheDocument();
    expect(within(preview).getByText("CR")).toBeInTheDocument();
    expect(api.fetchAvatar).toHaveBeenCalledTimes(1);
    expect(api.fetchAvatar).toHaveBeenCalledWith("/api/profiles/prof-a/avatar?size=96", expect.any(Function), expect.any(AbortSignal));
  });

  it("no 'interested', friends or mutuals: the data doesn't exist, so nothing claims it", async () => {
    member({ count: 5, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(toggle(region) as HTMLElement);
    expect(region).not.toHaveTextContent(/interested|mutual|friend/i);
  });
});
