// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { ApiError } from "@/lib/api/client";
import type { GoingAttendee, MyGoingStatus, Paginated, ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

// Live mode is on for the whole file; demo is a sample event with no organiser
// (the same gate TicketSelector uses), so it must still make no API calls.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = {
  getGoingSummary: vi.fn(),
  getMyGoingStatus: vi.fn(),
  listGoingAttendees: vi.fn(),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
  getMyProfile: vi.fn(),
  saveMyProfile: vi.fn(),
  deleteMyProfile: vi.fn(),
  createCheckoutSession: vi.fn(),
};
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...args: unknown[]) => api.getGoingSummary(...args),
  getMyGoingStatus: (...args: unknown[]) => api.getMyGoingStatus(...args),
  listGoingAttendees: (...args: unknown[]) => api.listGoingAttendees(...args),
  setGoing: (...args: unknown[]) => api.setGoing(...args),
  unsetGoing: (...args: unknown[]) => api.unsetGoing(...args),
}));
vi.mock("@/lib/api/profiles", () => ({
  getMyProfile: (...args: unknown[]) => api.getMyProfile(...args),
  saveMyProfile: (...args: unknown[]) => api.saveMyProfile(...args),
  deleteMyProfile: (...args: unknown[]) => api.deleteMyProfile(...args),
}));
vi.mock("@/lib/api/orders", () => ({
  createCheckoutSession: (...args: unknown[]) => api.createCheckoutSession(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}
const DEMO_EVENT = sample("neon-static");
const LIVE_EVENT: SheltuhEvent = { ...DEMO_EVENT, id: "evt-live-1", organiserId: "org-1" };

const PROFILE: ProfileRecord = {
  displayName: "Mia T.",
  suspended: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function people(n: number, prefix = "Person"): GoingAttendee[] {
  return Array.from({ length: n }, (_, i) => ({
    attendeeId: `${prefix}-${i}`,
    displayName: `${prefix} ${String.fromCharCode(65 + (i % 26))}.`,
    isYou: false,
  }));
}

function status(overrides: Partial<MyGoingStatus> = {}): MyGoingStatus {
  return { going: false, eligible: false, hasProfile: false, ...overrides };
}

/** Sets up the live API for a signed-in member. */
function member({
  count = 5,
  attendees = people(5),
  nextCursor,
  me = status(),
  profile = null,
}: {
  count?: number;
  attendees?: GoingAttendee[];
  nextCursor?: string;
  me?: MyGoingStatus;
  profile?: ProfileRecord | null;
} = {}) {
  api.getGoingSummary.mockResolvedValue({ count, closed: false });
  api.getMyGoingStatus.mockResolvedValue(me);
  api.listGoingAttendees.mockResolvedValue({ items: attendees, nextCursor } satisfies Paginated<GoingAttendee>);
  if (profile) api.getMyProfile.mockResolvedValue(profile);
  else api.getMyProfile.mockRejectedValue(new ApiError(404, "You haven't set up a profile yet."));
}

function renderEvent(event: SheltuhEvent, auth: AuthContextValue = fakeAuthValue({ email: "mia@example.com" })) {
  return render(
    <FakeAuthProvider value={auth}>
      <EventDetailsView event={event} demo={!event.organiserId} />
    </FakeAuthProvider>,
  );
}

const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined });

async function panel() {
  const region = await screen.findByRole("region", { name: "Who's going" });
  await waitFor(() => expect(region.closest("#whos-going")).not.toHaveAttribute("aria-busy"));
  return region;
}

function liveRegion(region: HTMLElement) {
  return within(region).getByRole("status");
}

function summaryLink() {
  return screen.queryByRole("link", { name: /^\d+ going$/ });
}

function names(region: HTMLElement) {
  const list = within(region).queryByRole("list", { name: "People going" });
  return list ? within(list).getAllByRole("listitem").map((li) => li.textContent) : [];
}

describe("Who's Going — demo", () => {
  it("shows the fixed sample names and count, with opting in disabled, and never calls the API", async () => {
    renderEvent(DEMO_EVENT, signedOut());
    const sampleData = getSampleGoing(DEMO_EVENT.id);
    const region = await panel();

    expect(within(region).getByText(String(sampleData.count)).closest("p")).toHaveTextContent(
      `${sampleData.count} going`,
    );
    expect(names(region)).toHaveLength(6);
    expect(names(region)[0]).toContain(sampleData.attendees[0].displayName);
    const add = within(region).getByRole("button", { name: "Add yourself" });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(within(region).getByRole("note")).toHaveTextContent("These names are samples.");
    expect(summaryLink()).toHaveAttribute("href", "#whos-going");
    expect(summaryLink()?.closest("p")).toHaveClass("lg:hidden");
    expect(summaryLink()).toHaveTextContent(`${sampleData.count} going`);

    // "Show more" works locally.
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    const shown = Math.min(18, sampleData.count);
    expect(names(region)).toHaveLength(shown);
    expect(liveRegion(region)).toHaveTextContent(`${shown - 6} more names shown.`);
    expect(document.activeElement).toHaveTextContent(sampleData.attendees[6].displayName);

    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("Who's Going — loading and errors", () => {
  it("shows a busy loading state while auth resolves, without calling the API or showing a number", () => {
    renderEvent(LIVE_EVENT, fakeAuthValue({ status: "loading", email: undefined }));
    const wrapper = document.getElementById("whos-going");
    expect(wrapper).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading who’s going…")).toBeInTheDocument();
    expect(summaryLink()).toBeNull();
    expect(api.getGoingSummary).not.toHaveBeenCalled();
  });

  it("shows and announces a load error, and Try again reloads", async () => {
    api.getGoingSummary.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    await within(region).findByText("Couldn't load who's going.", { selector: "div" });
    expect(liveRegion(region)).toHaveTextContent("Couldn't load who's going.");
    expect(summaryLink()).toBeNull();

    api.getGoingSummary.mockResolvedValueOnce({ count: 4, closed: false });
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going"));
    expect(api.getGoingSummary).toHaveBeenCalledTimes(2);
    expect(liveRegion(region)).toBeEmptyDOMElement();
  });

  it("isn't shown at all once closed (ended or switched off)", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 0, closed: true });
    renderEvent(LIVE_EVENT, signedOut());
    await waitFor(() => expect(api.getGoingSummary).toHaveBeenCalled());
    await waitFor(() => expect(document.getElementById("whos-going")).toBeNull());
    expect(summaryLink()).toBeNull();
    // Tickets are unaffected.
    expect(screen.getByRole("heading", { name: "Tickets" })).toBeInTheDocument();
  });
});

describe("Who's Going — signed out", () => {
  it("shows the count only (no names are requested) and a sign-in link back to this event", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 14, closed: false });
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();

    expect(within(region).getByText("14").closest("p")).toHaveTextContent("14 going");
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).getByRole("link", { name: "Sign in to see who’s going" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(`/events/${LIVE_EVENT.slug}`)}`,
    );
    expect(summaryLink()).toHaveTextContent("14 going");
    expect(api.getGoingSummary).toHaveBeenCalledWith(LIVE_EVENT.id);
    expect(api.listGoingAttendees).not.toHaveBeenCalled();
    expect(api.getMyGoingStatus).not.toHaveBeenCalled();
  });

  it("shows no number anywhere below three people", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 2, closed: false });
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(within(region).queryByText("2")).toBeNull();
    expect(region).not.toHaveTextContent(/\bgoing\b.*\d|\d+ going/);
    expect(summaryLink()).toBeNull();
    expect(within(region).getByText("Be one of the first to add yourself.")).toBeInTheDocument();
  });

  it("with nobody going, only offers sign in", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 0, closed: false });
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(within(region).queryByText("Be one of the first to add yourself.")).toBeNull();
    expect(within(region).getByRole("link", { name: "Sign in to see who’s going" })).toBeInTheDocument();
  });
});

describe("Who's Going — signed in", () => {
  it("without a ticket: shows names and points to the tickets, booked with their email", async () => {
    member({ count: 5, attendees: people(5) });
    renderEvent(LIVE_EVENT);
    const region = await panel();

    expect(names(region)).toHaveLength(5);
    expect(within(region).getByRole("link", { name: "Get a ticket" })).toHaveAttribute("href", "#tickets");
    expect(region).toHaveTextContent("Tickets count when they’re booked with mia@example.com.");
    expect(within(region).queryByRole("button", { name: "Add yourself" })).toBeNull();
    const report = within(region).getByRole("link", { name: "Report a name" });
    expect(report.getAttribute("href")).toMatch(/^mailto:support@sheltuh\.com\.au\?subject=/);
    expect(api.getMyGoingStatus).toHaveBeenCalledWith(LIVE_EVENT.id, expect.any(Function));
  });

  it("shows names but no number when fewer than three are going, and says so when nobody is", async () => {
    member({ count: 2, attendees: people(2) });
    renderEvent(LIVE_EVENT);
    let region = await panel();
    expect(names(region)).toHaveLength(2);
    expect(within(region).queryByText("2")).toBeNull();
    expect(summaryLink()).toBeNull();
    cleanup();

    member({ count: 0, attendees: [] });
    renderEvent(LIVE_EVENT);
    region = await panel();
    expect(within(region).getByText("No one’s added themselves yet.")).toBeInTheDocument();
    expect(within(region).queryByRole("list")).toBeNull();
  });

  it("explains that names need a verified email when the API refuses them (403)", async () => {
    member({ count: 4 });
    api.listGoingAttendees.mockReset().mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(region).toHaveTextContent("Verify your email address to see who’s going and add yourself.");
    expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going");
  });

  describe("eligible, first time (the opt-in form)", () => {
    beforeEach(() => member({ count: 3, attendees: people(3), me: status({ eligible: true }) }));

    async function openForm() {
      renderEvent(LIVE_EVENT);
      const region = await panel();
      const add = within(region).getByRole("button", { name: "Add yourself" });
      expect(add).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(add);
      expect(add).toHaveAttribute("aria-expanded", "true");
      expect(add).toHaveAttribute("aria-controls", "wg-form");
      const form = within(region).getByRole("form", { name: "Add yourself to who’s going" });
      return { region, add, form };
    }

    it("opens a labelled form, focuses the name, and keeps every control keyboard-reachable", async () => {
      const { form } = await openForm();
      const nameInput = within(form).getByLabelText("Display name");
      expect(nameInput).toHaveFocus();
      expect(nameInput).toHaveAttribute("maxlength", "40");
      expect(nameInput.getAttribute("aria-describedby")).toContain("wg-name-hint");
      const adult = within(form).getByRole("checkbox", { name: "I’m 18 or older" });
      const submit = within(form).getByRole("button", { name: "Show me as going" });
      expect(submit).toHaveAttribute("type", "submit");
      expect(submit).toHaveAttribute("aria-describedby", "wg-consent");
      expect(document.getElementById("wg-consent")).toHaveTextContent("We never show your email or ticket details.");
      expect(within(form).getByRole("link", { name: "How we handle your information" })).toHaveAttribute(
        "href",
        "/privacy",
      );
      for (const control of [nameInput, adult, submit, within(form).getByRole("button", { name: "Cancel" })]) {
        expect(control).toBeEnabled();
        expect(control).not.toHaveAttribute("tabindex", "-1");
      }

      fireEvent.change(nameInput, { target: { value: "Mia" } });
      expect(within(form).getByText("3/40")).toBeInTheDocument();
    });

    it("announces field errors, focuses the first invalid control and doesn't save", async () => {
      const { form } = await openForm();
      fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "   " } });
      fireEvent.submit(form);

      const nameInput = within(form).getByLabelText("Display name");
      expect(within(form).getByText("Enter a display name.")).toHaveAttribute("id", "wg-name-error");
      expect(nameInput).toHaveAttribute("aria-invalid", "true");
      expect(nameInput.getAttribute("aria-describedby")).toContain("wg-name-error");
      expect(nameInput).toHaveFocus();
      const adult = within(form).getByRole("checkbox", { name: "I’m 18 or older" });
      expect(adult).toHaveAttribute("aria-invalid", "true");
      expect(adult).toHaveAccessibleDescription("Confirm you're 18 or older to be shown.");

      // Name fixed, box still unticked: focus moves to the checkbox.
      fireEvent.change(nameInput, { target: { value: "Mia T." } });
      fireEvent.submit(form);
      expect(adult).toHaveFocus();
      expect(api.saveMyProfile).not.toHaveBeenCalled();
    });

    it("shows the API's display-name error on the field", async () => {
      api.saveMyProfile.mockRejectedValue(
        new ApiError(400, "Invalid input.", { displayName: "That name is reserved. Choose another." }),
      );
      const { form } = await openForm();
      fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "Admin" } });
      fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
      fireEvent.submit(form);

      const nameInput = within(form).getByLabelText("Display name");
      await waitFor(() => expect(nameInput).toHaveAccessibleDescription(expect.stringContaining("reserved")));
      expect(nameInput).toHaveFocus();
      expect(api.setGoing).not.toHaveBeenCalled();
    });

    it("creates the profile, opts in, shows and focuses the You row, and announces it", async () => {
      api.saveMyProfile.mockResolvedValue({ ...PROFILE, displayName: "Mia T." });
      api.setGoing.mockResolvedValue(status({ going: true, eligible: true, hasProfile: true }));
      const { region, form } = await openForm();
      fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "  Mia T.  " } });
      fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
      fireEvent.submit(form);

      await waitFor(() => expect(liveRegion(region)).toHaveTextContent("You're now shown as going as Mia T."));
      expect(api.saveMyProfile).toHaveBeenCalledWith({ displayName: "Mia T.", adultConfirmed: true }, expect.any(Function));
      expect(api.setGoing).toHaveBeenCalledWith(LIVE_EVENT.id, expect.any(Function));
      const you = names(region)[0];
      expect(you).toContain("You");
      expect(you).toContain("Shown as Mia T.");
      expect(document.activeElement).toHaveTextContent("Shown as Mia T.");
      expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going");
      expect(within(region).queryByRole("form")).toBeNull();
      expect(within(region).getByRole("button", { name: "Stop showing me" })).toBeInTheDocument();
    });

    it("Cancel closes the form and returns focus to Add yourself", async () => {
      const { region, add, form } = await openForm();
      fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
      expect(within(region).queryByRole("form")).toBeNull();
      expect(add).toHaveFocus();
      expect(add).toHaveAttribute("aria-expanded", "false");
    });

    it("marks the panel expanded while the form is open (so the desktop aside unsticks)", async () => {
      const { region } = await openForm();
      expect(region.closest("#whos-going")).toHaveAttribute("data-wg-expanded");
      expect(region.closest("aside")).toHaveClass("lg:has-[[data-wg-expanded]]:static");
    });
  });

  it("eligible with a profile: one tap opts in, busy while it's sent", async () => {
    member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
    let resolve: (value: MyGoingStatus) => void = () => {};
    api.setGoing.mockReturnValue(new Promise<MyGoingStatus>((r) => (resolve = r)));
    renderEvent(LIVE_EVENT);
    const region = await panel();

    expect(region).toHaveTextContent("Show up as Mia T.");
    expect(within(region).getByRole("link", { name: "Edit name" })).toHaveAttribute("href", "/account");
    fireEvent.click(within(region).getByRole("button", { name: "Show me as going" }));
    expect(within(region).getByRole("button", { name: "Adding you…" })).toBeDisabled();

    await act(async () => resolve(status({ going: true, eligible: true, hasProfile: true })));
    expect(liveRegion(region)).toHaveTextContent("You're now shown as going as Mia T.");
    expect(names(region)[0]).toContain("You");
    expect(api.saveMyProfile).not.toHaveBeenCalled();
  });

  it("going: You row first; Stop showing me opts out, announces it and moves focus to the next action", async () => {
    const you: GoingAttendee = { attendeeId: "me", displayName: "Mia T.", isYou: true };
    member({
      count: 4,
      attendees: [you, ...people(3)],
      me: status({ going: true, eligible: true, hasProfile: true }),
      profile: PROFILE,
    });
    api.unsetGoing.mockResolvedValue(status({ going: false, eligible: true, hasProfile: true }));
    renderEvent(LIVE_EVENT);
    const region = await panel();

    const rows = names(region);
    expect(rows).toHaveLength(4); // You + three others, no duplicate of the viewer
    expect(rows[0]).toContain("You");
    expect(rows.slice(1).join()).not.toContain("Mia T.");

    fireEvent.click(within(region).getByRole("button", { name: "Stop showing me" }));
    await waitFor(() => expect(liveRegion(region)).toHaveTextContent("You're no longer shown as going."));
    expect(api.unsetGoing).toHaveBeenCalledWith(LIVE_EVENT.id, expect.any(Function));
    expect(names(region)).toHaveLength(3);
    expect(within(region).getByText("3").closest("p")).toHaveTextContent("3 going");
    expect(within(region).getByRole("button", { name: "Show me as going" })).toHaveFocus();
  });

  it("shows a mutation error and re-enables the button", async () => {
    member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
    api.setGoing.mockRejectedValue(new ApiError(500, "Internal error"));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(within(region).getByRole("button", { name: "Show me as going" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Couldn't update that. Try again.");
    expect(within(region).getByRole("button", { name: "Show me as going" })).toBeEnabled();
  });

  it("Show more reveals loaded names first, then fetches the next page; a failure is shown", async () => {
    member({ count: 30, attendees: people(8), nextCursor: "c2" });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(names(region)).toHaveLength(6);

    api.listGoingAttendees.mockResolvedValueOnce({ items: people(12, "More") });
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(names(region)).toHaveLength(18));
    expect(api.listGoingAttendees).toHaveBeenLastCalledWith(LIVE_EVENT.id, expect.any(Function), "c2");
    expect(liveRegion(region)).toHaveTextContent("12 more names shown.");
    expect(document.activeElement).toHaveTextContent("Person G.");

    // 2 loaded but unshown remain, and there's no further cursor: reveal them, end of list.
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    expect(names(region)).toHaveLength(20);
    expect(liveRegion(region)).toHaveTextContent("2 more names shown. That's everyone.");
    expect(within(region).queryByRole("button", { name: "Show more" })).toBeNull();
    expect(api.listGoingAttendees).toHaveBeenCalledTimes(2);
  });

  it("keeps Show more and says so when the next page fails", async () => {
    member({ count: 30, attendees: people(6), nextCursor: "c2" });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    api.listGoingAttendees.mockRejectedValueOnce(new ApiError(500, "nope"));
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    expect(await within(region).findByText("Couldn’t load more names.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Show more" })).toBeEnabled();
    expect(names(region)).toHaveLength(6);
  });
});
