// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { ApiError } from "@/lib/api/client";
import type { GoingAttendee, MyGoingStatus, Paginated, ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
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

/** The public summary as the API sends it: under three, the count is withheld (sent as 0). */
function summary(count: number) {
  const countHidden = count < 3;
  return { count: countHidden ? 0 : count, closed: false, countHidden };
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
  api.getGoingSummary.mockResolvedValue(summary(count));
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

    api.getGoingSummary.mockResolvedValueOnce(summary(4));
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going"));
    expect(api.getGoingSummary).toHaveBeenCalledTimes(2);
    expect(liveRegion(region)).toBeEmptyDOMElement();
  });

  it("isn't shown at all once closed (ended or switched off)", async () => {
    api.getGoingSummary.mockResolvedValue({ count: 0, closed: true, countHidden: false });
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
    api.getGoingSummary.mockResolvedValue(summary(14));
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

  it("shows no number anywhere when the API withholds it (under three), and invites people to be first", async () => {
    api.getGoingSummary.mockResolvedValue(summary(2));
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(region).not.toHaveTextContent(/\d/);
    expect(summaryLink()).toBeNull();
    expect(within(region).getByText("Be one of the first to add yourself.")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Sign in to see who’s going" })).toBeInTheDocument();
  });

  it("with a shown count, doesn't say be one of the first", async () => {
    api.getGoingSummary.mockResolvedValue(summary(3));
    renderEvent(LIVE_EVENT, signedOut());
    const region = await panel();
    expect(within(region).getByText("3").closest("p")).toHaveTextContent("3 going");
    expect(within(region).queryByText("Be one of the first to add yourself.")).toBeNull();
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
    const report = within(region).getByRole("link", { name: "Report a name (by email)" });
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

  it("explains that names need a verified email when the API refuses them (403) and there is a profile", async () => {
    member({ count: 4, profile: PROFILE });
    api.listGoingAttendees.mockReset().mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(region).toHaveTextContent("Verify your email address to see who’s going and add yourself.");
    expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going");
  });

  it("without a profile or a ticket (403 on names): points to setting up a profile", async () => {
    member({ count: 4 });
    api.listGoingAttendees.mockReset().mockRejectedValue(new ApiError(403, "Create a profile to see who's going."));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(within(region).queryByRole("list")).toBeNull();
    expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going");
    expect(region).toHaveTextContent("Names are shown to members with a Who’s Going profile.");
    expect(within(region).getByRole("link", { name: "Set up your profile" })).toHaveAttribute("href", "/account");
    expect(within(region).getByRole("link", { name: "Get a ticket" })).toBeInTheDocument();
    expect(region).not.toHaveTextContent("Verify your email");
  });

  it("rate-limited names (429): a calm try-later message, not the error state", async () => {
    member({ count: 4, profile: PROFILE, me: status({ eligible: true, hasProfile: true }) });
    api.listGoingAttendees.mockReset().mockRejectedValueOnce(new ApiError(429, "Too many requests."));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(region).toHaveTextContent("Lots of people are looking right now. Try again in a few minutes.");
    expect(region).not.toHaveTextContent("Couldn't load who's going.");
    expect(within(region).queryByRole("alert")).toBeNull();
    // Opting in still works meanwhile.
    expect(within(region).getByRole("button", { name: "Show me as going" })).toBeInTheDocument();

    api.listGoingAttendees.mockResolvedValue({ items: people(4) });
    fireEvent.click(within(region).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(names(region)).toHaveLength(4));
    expect(region).not.toHaveTextContent("Lots of people are looking");
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
      // No maxlength: it counts UTF-16 units, not the code points the API counts.
      expect(nameInput).not.toHaveAttribute("maxlength");
      expect(nameInput.getAttribute("aria-describedby")).toContain("wg-name-hint");
      const adult = within(form).getByRole("checkbox", { name: "I’m 18 or older" });
      const submit = within(form).getByRole("button", { name: "Show me as going" });
      expect(submit).toHaveAttribute("type", "submit");
      expect(submit).toHaveAttribute("aria-describedby", "wg-consent");
      expect(document.getElementById("wg-consent")).toHaveTextContent("We never show your email or ticket details.");
      expect(within(form).getByRole("link", { name: "How we handle your information" })).toHaveAttribute(
        "href",
        "/privacy#whos-going",
      );
      for (const control of [nameInput, adult, submit, within(form).getByRole("button", { name: "Cancel" })]) {
        expect(control).toBeEnabled();
        expect(control).not.toHaveAttribute("tabindex", "-1");
      }

      fireEvent.change(nameInput, { target: { value: "Mia" } });
      expect(within(form).getByText("3/40")).toBeInTheDocument();
    });

    it("says honestly what's shown: removal here or everywhere, one-tap reuse, the same name on every event", async () => {
      const { form } = await openForm();
      const consent = document.getElementById("wg-consent");
      expect(consent).toHaveTextContent("You can remove yourself from this event at any time on this page");
      expect(consent).toHaveTextContent("delete your profile from your account to leave every event");
      expect(consent).toHaveTextContent("saved so you can add yourself to other events in one tap");
      expect(consent).toHaveTextContent(
        "it’s the same on every event you join, so signed-in members can see which events you’ve joined",
      );
      // Adding yourself also means people going can message you, request first.
      expect(consent).toHaveTextContent(
        "Others who’ve added themselves to this event can send you a message request: one message, and nothing more unless you reply. You can decline, block or report anyone.",
      );
      expect(within(form).getByRole("link", { name: "How we handle your information" })).toHaveAttribute(
        "href",
        "/privacy#whos-going",
      );
    });

    it("counts the name in code points, not UTF-16 units (an emoji is one of the 40)", async () => {
      api.saveMyProfile.mockReturnValue(new Promise(() => {}));
      const { form } = await openForm();
      const nameInput = within(form).getByLabelText("Display name");
      fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));

      fireEvent.change(nameInput, { target: { value: `Mia${"🎉".repeat(38)}` } }); // 41 code points, 79 UTF-16 units
      expect(within(form).getByText("41/40")).toHaveClass("text-danger");
      fireEvent.submit(form);
      expect(nameInput).toHaveAccessibleDescription(expect.stringContaining("Keep it to 40 characters or fewer."));
      expect(api.saveMyProfile).not.toHaveBeenCalled();

      fireEvent.change(nameInput, { target: { value: `Mia${"🎉".repeat(37)}` } }); // 40 code points, 77 UTF-16 units
      expect(within(form).getByText("40/40")).toHaveClass("text-muted");
      fireEvent.submit(form);
      expect(api.saveMyProfile).toHaveBeenCalledWith(
        { displayName: `Mia${"🎉".repeat(37)}`, adultConfirmed: true },
        expect.any(Function),
      );
    });

    it("keeps focus on the submit button through a failed save (busy, not disabled)", async () => {
      let reject: (err: unknown) => void = () => {};
      api.saveMyProfile.mockReturnValue(new Promise((_, rj) => (reject = rj)));
      const { form } = await openForm();
      fireEvent.change(within(form).getByLabelText("Display name"), { target: { value: "Mia T." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
      const submit = within(form).getByRole("button", { name: "Show me as going" });
      submit.focus();
      fireEvent.submit(form);

      const busy = within(form).getByRole("button", { name: "Adding you…" });
      expect(busy).not.toBeDisabled();
      expect(busy).toHaveAttribute("aria-disabled", "true");
      expect(within(form).getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
      fireEvent.submit(form); // a second submit while busy is ignored
      expect(api.saveMyProfile).toHaveBeenCalledTimes(1);

      await act(async () => reject(new ApiError(500, "boom")));
      expect(within(form).getByRole("alert")).toHaveTextContent("Couldn't update that. Try again.");
      expect(within(form).getByRole("button", { name: "Show me as going" })).toHaveFocus();
    });

    it("catches the cheap server rules before saving: a letter or number, no invisible characters", async () => {
      const { form } = await openForm();
      const nameInput = within(form).getByLabelText("Display name");
      fireEvent.click(within(form).getByRole("checkbox", { name: "I’m 18 or older" }));
      fireEvent.change(nameInput, { target: { value: "🎉🎉" } });
      fireEvent.submit(form);
      expect(nameInput).toHaveAccessibleDescription(
        expect.stringContaining("Display names need at least one letter or number."),
      );
      fireEvent.change(nameInput, { target: { value: "Mia\u200BT." } });
      fireEvent.submit(form);
      expect(nameInput).toHaveAccessibleDescription(
        expect.stringContaining("Display names can't contain invisible or control characters."),
      );
      expect(api.saveMyProfile).not.toHaveBeenCalled();
    });

    it("names are shown only with a profile (403): says adding yourself shows them", async () => {
      api.listGoingAttendees.mockReset().mockRejectedValue(new ApiError(403, "Create a profile to see who's going."));
      renderEvent(LIVE_EVENT);
      const region = await panel();
      expect(within(region).queryByRole("list")).toBeNull();
      expect(region).toHaveTextContent("Want people to know you’re going? Add yourself to see who else is.");
      expect(within(region).getByRole("button", { name: "Add yourself" })).toBeInTheDocument();
      expect(region).not.toHaveTextContent("Verify your email");
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

    expect(region).toHaveTextContent("Show up as Mia T. Edit name");
    expect(region).not.toHaveTextContent("Mia T..");
    expect(within(region).getByRole("link", { name: "Edit name" })).toHaveAttribute("href", "/account");
    const button = within(region).getByRole("button", { name: "Show me as going" });
    button.focus();
    fireEvent.click(button);
    const busy = within(region).getByRole("button", { name: "Adding you…" });
    expect(busy).not.toBeDisabled(); // `disabled` would drop focus to the page
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    fireEvent.click(busy); // ignored while busy
    expect(api.setGoing).toHaveBeenCalledTimes(1);

    await act(async () => resolve(status({ going: true, eligible: true, hasProfile: true })));
    // No doubled full stop after a name that ends in one.
    expect(liveRegion(region)).toHaveTextContent(/^You're now shown as going as Mia T\.$/);
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

  describe("messaging people on the list", () => {
    const you: GoingAttendee = { attendeeId: "me", displayName: "Mia T.", isYou: true };

    it("going: each other person has a Message button (not the You row), which opens a request form", async () => {
      member({
        count: 4,
        attendees: [you, ...people(3)],
        me: status({ going: true, eligible: true, hasProfile: true }),
        profile: PROFILE,
      });
      renderEvent(LIVE_EVENT);
      const region = await panel();
      const buttons = within(region).getAllByRole("button", { name: /^Message / });
      expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
        "Message Person A.",
        "Message Person B.",
        "Message Person C.",
      ]);
      expect(names(region)[0]).not.toContain("Message");
      fireEvent.click(buttons[1]);
      expect(within(region).getByRole("form", { name: "Message Person B." })).toBeInTheDocument();
      expect(region.closest("#whos-going")).toHaveAttribute("data-wg-expanded");
      expect(within(region).getByRole("link", { name: "Your messages" })).toHaveAttribute("href", "/messages");
    });

    it("not going yourself: no Message buttons (you have to be on the list to message it)", async () => {
      member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
      renderEvent(LIVE_EVENT);
      const region = await panel();
      expect(names(region)).toHaveLength(3);
      expect(within(region).queryAllByRole("button", { name: /^Message / })).toHaveLength(0);
    });

    it("suspended: no Message buttons", async () => {
      member({
        count: 4,
        attendees: [you, ...people(3)],
        me: status({ going: true, eligible: true, hasProfile: true }),
        profile: { ...PROFILE, suspended: true },
      });
      renderEvent(LIVE_EVENT);
      const region = await panel();
      expect(within(region).queryAllByRole("button", { name: /^Message / })).toHaveLength(0);
    });

    it("demo: no Message buttons on the sample names", async () => {
      renderEvent(DEMO_EVENT, signedOut());
      const region = await panel();
      expect(within(region).queryAllByRole("button", { name: /^Message / })).toHaveLength(0);
    });
  });

  it("shows a mutation error, re-enables the button and keeps focus on it", async () => {
    member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
    api.setGoing.mockRejectedValue(new ApiError(500, "Internal error"));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(within(region).getByRole("button", { name: "Show me as going" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Couldn't update that. Try again.");
    const button = within(region).getByRole("button", { name: "Show me as going" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).toHaveFocus();
  });

  it("when the profile has gone (409), moves focus to Add yourself rather than losing it", async () => {
    member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
    api.setGoing.mockRejectedValue(new ApiError(409, "Set up your Who's Going profile first."));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(within(region).getByRole("button", { name: "Show me as going" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Set up your Who's Going profile first.");
    expect(within(region).getByRole("button", { name: "Add yourself" })).toHaveFocus();
  });

  it("keeps focus on Stop showing me when opting out fails", async () => {
    const you: GoingAttendee = { attendeeId: "me", displayName: "Mia T.", isYou: true };
    member({
      count: 4,
      attendees: [you, ...people(3)],
      me: status({ going: true, eligible: true, hasProfile: true }),
      profile: PROFILE,
    });
    api.unsetGoing.mockRejectedValue(new ApiError(500, "Internal error"));
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(within(region).getByRole("button", { name: "Stop showing me" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Couldn't update that. Try again.");
    expect(within(region).getByRole("button", { name: "Stop showing me" })).toHaveFocus();
    expect(within(region).getByText("4").closest("p")).toHaveTextContent("4 going");
  });

  it("offers Sign in, back to this panel, when the session has expired", async () => {
    member({ count: 3, attendees: people(3), me: status({ eligible: true, hasProfile: true }), profile: PROFILE });
    api.setGoing.mockRejectedValue(new SessionExpiredError());
    renderEvent(LIVE_EVENT);
    const region = await panel();
    fireEvent.click(within(region).getByRole("button", { name: "Show me as going" }));
    const alert = await within(region).findByRole("alert");
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to continue.");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(`/events/${LIVE_EVENT.slug}#whos-going`)}`,
    );
  });

  it("a suspended member who was going sees the notice, not You or Stop showing me", async () => {
    member({
      count: 3,
      attendees: people(3), // the API leaves suspended members out of the list
      me: status({ going: true, eligible: true, hasProfile: true }),
      profile: { ...PROFILE, suspended: true },
    });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    expect(region).toHaveTextContent("Your display name is hidden from Who’s Going.");
    expect(names(region).join()).not.toContain("You");
    expect(within(region).queryByRole("button", { name: "Stop showing me" })).toBeNull();
    expect(within(region).getByText("3").closest("p")).toHaveTextContent("3 going");
  });

  it("clips initials to their square", async () => {
    member({ count: 3, attendees: [{ attendeeId: "w", displayName: "Wwwwwww Wwwwww", isYou: false }] });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    const avatar = within(region).getByText("WW");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveClass("size-8", "overflow-hidden");
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

  it("says to try later when Show more is rate-limited (429)", async () => {
    member({ count: 30, attendees: people(6), nextCursor: "c2" });
    renderEvent(LIVE_EVENT);
    const region = await panel();
    api.listGoingAttendees.mockRejectedValueOnce(new ApiError(429, "Too many requests."));
    fireEvent.click(within(region).getByRole("button", { name: "Show more" }));
    expect(
      await within(region).findByText("Lots of people are looking right now. Try again in a few minutes."),
    ).toBeInTheDocument();
    expect(names(region)).toHaveLength(6);
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
