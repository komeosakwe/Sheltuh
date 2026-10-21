// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CheckInPage from "@/components/check-in/CheckInPage";
import { ApiError } from "@/lib/api/client";
import type { CheckInResult } from "@/lib/api/types";
import {
  admitted,
  advance,
  deferred,
  EARLIER,
  logEntry,
  NOW,
  stubBrowser,
  stubDialog,
  summary,
  TICKET,
  useDoorClock,
} from "./test-utils/checkInFixtures";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The door scanner page without the camera (manual entry drives every scan):
 * gate states, every outcome's words and announcements, the timing rules,
 * Not verified + Retry, undo, counters, offline, settings.
 * Camera behaviour is in CheckInScanner.test.tsx.
 */

const api = { checkInTicket: vi.fn(), undoCheckIn: vi.fn(), getCheckInSummary: vi.fn() };
vi.mock("@/lib/api/check-ins", () => ({
  checkInTicket: (...a: unknown[]) => api.checkInTicket(...a),
  undoCheckIn: (...a: unknown[]) => api.undoCheckIn(...a),
  getCheckInSummary: (...a: unknown[]) => api.getCheckInSummary(...a),
}));

type OrganiserState = { loading: boolean; organiser: { organiserId: string; status: string } | null; error: string | null };
let organiserState: OrganiserState;
vi.mock("@/lib/auth/useOrganiser", () => ({ useOrganiser: () => ({ ...organiserState, refetch: vi.fn() }) }));

// The camera is never started here; keep the real detector module out of jsdom.
vi.mock("@/lib/check-in/detector", () => ({ loadQrDetector: () => new Promise(() => {}) }));

let online = true;
let uuid = 0;
beforeAll(stubDialog);
beforeEach(() => {
  useDoorClock();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCheckInSummary.mockResolvedValue(summary());
  organiserState = { loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null };
  online = true;
  stubBrowser();
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  uuid = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    uuid += 1;
    return `00000000-0000-4000-8000-${String(uuid).padStart(12, "0")}`;
  });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "vibrate");
});

async function renderPage(auth = fakeAuthValue()) {
  const view = render(
    <FakeAuthProvider value={auth}>
      <CheckInPage eventId="evt-1" />
    </FakeAuthProvider>,
  );
  await advance();
  return view;
}

const slot = () => screen.getByRole("region", { name: "Scanner" });
const input = () => screen.getByLabelText("Type a code");
const resultAnnouncer = () => screen.getByTestId("result-announcer");
const statusAnnouncer = () => screen.getByTestId("status-announcer");

/** Types a code and presses Check; settles the request if it's already resolved. */
async function typeAndCheck(code: string) {
  fireEvent.change(input(), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /^(Check|Checking…)$/ }));
  await advance();
}

/**
 * Let the clear-then-set announcement land (next animation frame). The fake
 * clock's frames are 16ms apart from when it was installed, and NOW is set
 * after that, so the next one can be up to 32ms away.
 */
async function nextFrame() {
  await advance(40);
}

/** The result panel in the scanner slot. */
const panel = () => {
  const element = slot().querySelector<HTMLElement>("[data-result]");
  if (!element) throw new Error("No result panel");
  return element;
};

describe("check-in gate", () => {
  it("demo mode: says accounts aren't configured, in the door scope, and calls nothing", async () => {
    const { container } = await renderPage(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Accounts aren’t configured in this environment yet. Door check-in needs a live Sheltüh account.",
    );
    expect(container.querySelector("[data-door]")).not.toBeNull();
    expect(api.getCheckInSummary).not.toHaveBeenCalled();
  });

  it("loading: says so", async () => {
    await renderPage(fakeAuthValue({ status: "loading" }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("signed out: a page heading and Sign in back to this page", async () => {
    await renderPage(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to check people in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fevt-1%2Fcheck-in");
  });

  it("not an organiser: says what's needed for the door", async () => {
    organiserState = { loading: false, organiser: null, error: null };
    await renderPage();
    expect(
      screen.getByText("You need an approved organiser application before you can check people in at the door."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Apply as an organiser" })).toBeInTheDocument();
    expect(api.getCheckInSummary).not.toHaveBeenCalled();
  });

  it("pending organiser: the pending copy", async () => {
    organiserState = { loading: false, organiser: { organiserId: "o", status: "pending" }, error: null };
    await renderPage();
    expect(screen.getByText("Your organiser application is still pending review.")).toBeInTheDocument();
  });

  it("organiser error: shown, not swallowed", async () => {
    organiserState = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
  });

  it("not your event (404): Event not found, with the way back", async () => {
    api.getCheckInSummary.mockRejectedValue(new ApiError(404, "Not found."));
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Event not found" })).toBeInTheDocument();
    expect(screen.getByText(/Only the organiser who owns an event can check people in\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your events" })).toHaveAttribute("href", "/dashboard");
  });

  it("403 from the API: the not-approved copy", async () => {
    api.getCheckInSummary.mockRejectedValue(new ApiError(403, "Forbidden."));
    await renderPage();
    expect(
      screen.getByText("You need an approved organiser application before you can check people in at the door."),
    ).toBeInTheDocument();
  });

  it("401 from the API: as signed out", async () => {
    api.getCheckInSummary.mockRejectedValue(new ApiError(401, "Signed out."));
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to check people in" })).toBeInTheDocument();
  });

  it("other first-load failure: Couldn't load, and Try again loads it", async () => {
    api.getCheckInSummary.mockRejectedValueOnce(new ApiError(0, "Offline."));
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Couldn’t load check-in" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await advance();
    expect(screen.getByRole("heading", { level: 1, name: "Night Market" })).toBeInTheDocument();
  });

  it("first load in progress: a muted title and empty counters, with manual entry already usable", async () => {
    api.getCheckInSummary.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Loading check-in…" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(input()).toBeEnabled();
  });
});

describe("header and counters", () => {
  it("shows the event, the counts and capacity, and links back", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Night Market" })).toBeInTheDocument();
    const count = screen.getByRole("region", { name: "Count" });
    expect(within(count).getByText("100")).toBeInTheDocument();
    expect(within(count).getByText("of 240 sold · 140 to come")).toBeInTheDocument();
    expect(within(count).getByText("Capacity 300")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Your events" })).toHaveAttribute("href", "/dashboard");
  });

  it("no sales: says so", async () => {
    api.getCheckInSummary.mockResolvedValue(summary({ checkedIn: 0, ticketsSold: 0, recent: [] }));
    await renderPage();
    expect(screen.getByText("of 0 sold")).toBeInTheDocument();
    expect(screen.getByText("No tickets have been sold for this event yet.")).toBeInTheDocument();
    expect(screen.getByText("No scans yet. Scanned tickets show here.")).toBeInTheDocument();
  });

  it("polls every 15 seconds while visible, and announces a changed count politely after it settles, never on load", async () => {
    await renderPage();
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("count-announcer")).toHaveTextContent("");
    api.getCheckInSummary.mockResolvedValue(summary({ checkedIn: 101 }));
    await advance(14_999);
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("count-announcer")).toHaveTextContent("");
    await advance(1500);
    const announcer = screen.getByTestId("count-announcer");
    expect(announcer).toHaveTextContent("101 checked in of 240 sold.");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    await advance(15_000);
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(3);
  });

  it("a failed refresh keeps the numbers and says when they were last updated", async () => {
    await renderPage();
    api.getCheckInSummary.mockRejectedValue(new ApiError(0, "Offline."));
    await advance(15_000);
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Counts last updated 8:56 pm. Retrying…")).toBeInTheDocument();
    expect(screen.getByText("Couldn’t refresh the list. It updates again when you’re back online.")).toBeInTheDocument();
  });
});

describe("manual entry", () => {
  it.each([
    ["7kqm2hxd", "a bare code without the hyphen"],
    ["7KQM-2HXD", "a bare code"],
    ["SH1:7KQM-2HXD", "the QR form"],
  ])("sends %s (%s) as the canonical code with a fresh request id", async (typed) => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await typeAndCheck(typed);
    expect(api.checkInTicket).toHaveBeenCalledWith(
      "evt-1",
      "7KQM-2HXD",
      "00000000-0000-4000-8000-000000000001",
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("garbage: an inline error tied to the field, focus kept there, nothing sent", async () => {
    await renderPage();
    input().focus();
    await typeAndCheck("hello");
    const error = screen.getByText("That’s not a ticket code. Codes have 8 letters and numbers, like 7KQM-2HXD.");
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input().getAttribute("aria-describedby")).toContain(error.id);
    expect(input()).toHaveFocus();
    expect(api.checkInTicket).not.toHaveBeenCalled();
    // The error isn't a result: the assertive region stays quiet.
    await nextFrame();
    expect(resultAnnouncer()).toHaveTextContent("");
  });

  it("clears after a result and keeps focus in the field", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    input().focus();
    await typeAndCheck("7KQM-2HXD");
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
  });
});

describe("outcomes", () => {
  it("admitted: LET IN with the ticket, no actions, the assertive announcement and a local +1", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    const panel = slot().querySelector("[data-result]");
    expect(panel).toHaveAttribute("data-result", "admit");
    const s = within(slot());
    expect(s.getByText("Let in")).toBeInTheDocument();
    expect(s.getByText("Checked in")).toBeInTheDocument();
    expect(s.getByText("General admission")).toBeInTheDocument();
    expect(s.getByText("Ticket 2 of 3 · Code ends 2HXD")).toBeInTheDocument();
    expect(within(panel as HTMLElement).queryByRole("button")).toBeNull();
    expect(panel).not.toHaveAttribute("aria-live");
    await nextFrame();
    expect(resultAnnouncer()).toHaveTextContent("Let in. General admission, ticket 2 of 3.");
    expect(resultAnnouncer()).toHaveAttribute("aria-live", "assertive");
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("101")).toBeInTheDocument();
  });

  const refusals: [string, CheckInResult, string[], string][] = [
    [
      "already checked in",
      { outcome: "already_checked_in", ticket: TICKET, checkedInAt: EARLIER },
      ["Already checked in", "First checked in 8:42 pm (14 min ago)"],
      "Don’t let in. Already checked in at 8:42 pm.",
    ],
    [
      "void",
      { outcome: "not_admissible", ticket: TICKET },
      ["Ticket void", "Its order was refunded or isn’t paid."],
      "Don’t let in. Ticket void.",
    ],
    [
      "wrong event",
      { outcome: "other_event", ticket: TICKET, otherEventTitle: "Late Show" },
      ["Wrong event", "General admission · Ticket 2 of 3 · Code ends 2HXD"],
      "Don’t let in. Ticket for Late Show.",
    ],
    [
      "invalid",
      { outcome: "invalid" },
      ["Not a valid ticket", "This code isn’t a ticket for any of your events."],
      "Don’t let in. Not a valid ticket.",
    ],
  ];

  it.each(refusals)("%s: DON'T LET IN, its reason, Scan next, and the announcement", async (_label, result, texts, said) => {
    api.checkInTicket.mockResolvedValue(result);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(slot().querySelector("[data-result]")).toHaveAttribute("data-result", "refuse");
    const s = within(slot());
    expect(s.getByText("Don’t let in")).toBeInTheDocument();
    for (const text of texts) expect(s.getByText(text)).toBeInTheDocument();
    expect(s.getByRole("button", { name: "Scan next" })).toBeInTheDocument();
    await nextFrame();
    expect(resultAnnouncer()).toHaveTextContent(said);
    // Not counted locally.
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("100")).toBeInTheDocument();
  });

  it("wrong event names the other event in bold", async () => {
    api.checkInTicket.mockResolvedValue({ outcome: "other_event", ticket: TICKET, otherEventTitle: "Late Show" });
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(within(slot()).getByText("Late Show").tagName).toBe("STRONG");
  });

  it("already checked in by this device a moment ago: says so", async () => {
    api.checkInTicket.mockResolvedValueOnce(admitted);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await advance(4000);
    api.checkInTicket.mockResolvedValueOnce({ outcome: "already_checked_in", ticket: TICKET, checkedInAt: NOW.toISOString() });
    await typeAndCheck("7KQM-2HXD");
    expect(within(slot()).getByText("Checked in on this device 4 sec ago.")).toBeInTheDocument();
  });

  const failures: [string, ApiError, string, string[]][] = [
    ["network", new ApiError(0, "x"), "Couldn’t reach Sheltüh. Nothing was marked. Retry when you have signal.", ["Retry", "Scan another"]],
    ["429", new ApiError(429, "x"), "Too many scans in the last few minutes. Nothing was marked. Wait a few seconds, then retry.", ["Retry", "Scan another"]],
    ["5xx", new ApiError(502, "x"), "Sheltüh had a problem. Nothing was marked. Retry in a moment.", ["Retry", "Scan another"]],
    ["400", new ApiError(400, "x"), "This scan couldn’t be sent. Nothing was marked. Type the code below instead.", ["Scan another"]],
    ["413", new ApiError(413, "x"), "This scan couldn’t be sent. Nothing was marked. Type the code below instead.", ["Scan another"]],
  ];

  it.each(failures)("%s: NOT VERIFIED, nothing marked, and the right actions", async (_label, error, detail, buttons) => {
    api.checkInTicket.mockRejectedValue(error);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(slot().querySelector("[data-result]")).toHaveAttribute("data-result", "hold");
    const s = within(slot());
    expect(s.getByText("Not verified")).toBeInTheDocument();
    expect(s.getByText("Don’t let in yet")).toBeInTheDocument();
    expect(s.getByText(detail)).toBeInTheDocument();
    expect(within(panel()).getAllByRole("button").map((b) => b.textContent)).toEqual(buttons);
    // The camera controls underneath are out of the focus order while it shows.
    expect(screen.getByRole("button", { name: "Start camera" }).closest("[inert]")).not.toBeNull();
    await nextFrame();
    expect(resultAnnouncer()).toHaveTextContent("Not verified. Don’t let in yet. Retry.");
    // Not verified keeps the typed code, for a retry.
    expect(input()).toHaveValue("7KQM-2HXD");
  });

  it("401: Sign in back to this page, no Retry", async () => {
    api.checkInTicket.mockRejectedValue(new ApiError(401, "x"));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    const s = within(slot());
    expect(s.getByText("You’ve been signed out. Nothing was marked. Sign in again, then retry.")).toBeInTheDocument();
    expect(s.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fevt-1%2Fcheck-in");
    expect(s.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("403/404: Back to your events", async () => {
    api.checkInTicket.mockRejectedValue(new ApiError(404, "x"));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    const s = within(slot());
    expect(s.getByText("This account can’t check people in for this event. Nothing was marked.")).toBeInTheDocument();
    expect(s.getByRole("link", { name: "Back to your events" })).toHaveAttribute("href", "/dashboard");
  });
});

describe("timing", () => {
  it("shows Checking… only after 250ms, with the code's last four", async () => {
    const pending = deferred<CheckInResult>();
    api.checkInTicket.mockReturnValue(pending.promise);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await advance(249);
    expect(within(slot()).queryByText("Checking…")).toBeNull();
    await advance(1);
    expect(within(slot()).getByText("Checking…")).toBeInTheDocument();
    expect(within(slot()).getByText("Code ends 2HXD")).toBeInTheDocument();
    // The manual button is busy (one request at a time) and keeps its focusability.
    const busy = screen.getByRole("button", { name: "Checking…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    pending.resolve(admitted);
    await advance();
    expect(within(slot()).queryByText("Checking…")).toBeNull();
    expect(within(slot()).getByText("Let in")).toBeInTheDocument();
  });

  it("a fast answer never shows Checking…", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(within(slot()).queryByText("Checking…")).toBeNull();
  });

  it("one request at a time: a second submit while one is in flight sends nothing", async () => {
    const pending = deferred<CheckInResult>();
    api.checkInTicket.mockReturnValue(pending.promise);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await typeAndCheck("ABCD-EFGH");
    fireEvent.submit(input().closest("form") as HTMLFormElement);
    await advance();
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    pending.resolve(admitted);
    await advance();
  });

  it("aborts at 8 seconds: Not verified, and Retry resends the same request id", async () => {
    api.checkInTicket.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    const signal = api.checkInTicket.mock.calls[0][4] as AbortSignal;
    await advance(7999);
    expect(signal.aborted).toBe(false);
    expect(within(slot()).queryByText("Not verified")).toBeNull();
    await advance(1);
    expect(signal.aborted).toBe(true);
    expect(within(slot()).getByText("Not verified")).toBeInTheDocument();
    expect(within(slot()).getByText("Couldn’t reach Sheltüh. Nothing was marked. Retry when you have signal.")).toBeInTheDocument();

    const retried = deferred<CheckInResult>();
    api.checkInTicket.mockReturnValue(retried.promise);
    fireEvent.click(within(slot()).getByRole("button", { name: "Retry" }));
    await advance();
    // The panel stays while retrying, with a busy button.
    expect(within(slot()).getByRole("button", { name: "Retrying…" })).toHaveAttribute("aria-disabled", "true");
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
    expect(api.checkInTicket.mock.calls[1][2]).toBe(api.checkInTicket.mock.calls[0][2]);
    // A lost response's retry says admitted: the normal Let-in panel.
    retried.resolve(admitted);
    await advance();
    expect(within(slot()).getByText("Let in")).toBeInTheDocument();
  });

  it("typing the Not-verified code again retries it (same request id); a different code is a new scan", async () => {
    api.checkInTicket.mockRejectedValueOnce(new ApiError(0, "x"));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    api.checkInTicket.mockRejectedValueOnce(new ApiError(0, "x"));
    await typeAndCheck("7kqm 2hxd");
    expect(api.checkInTicket.mock.calls[1][2]).toBe(api.checkInTicket.mock.calls[0][2]);
    api.checkInTicket.mockResolvedValueOnce(admitted);
    await typeAndCheck("ABCD-EFGH");
    expect(api.checkInTicket.mock.calls[2][2]).not.toBe(api.checkInTicket.mock.calls[0][2]);
  });

  it("Not verified stays until resolved; Scan another clears it", async () => {
    api.checkInTicket.mockRejectedValue(new ApiError(503, "x"));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await advance(60_000);
    expect(within(slot()).getByText("Not verified")).toBeInTheDocument();
    fireEvent.click(within(slot()).getByRole("button", { name: "Scan another" }));
    await advance();
    expect(slot().querySelector("[data-result]")).toBeNull();
  });

  it("Let in returns to the viewfinder after 2.5s", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await advance(2499);
    expect(within(slot()).getByText("Let in")).toBeInTheDocument();
    await advance(1);
    expect(slot().querySelector("[data-result]")).toBeNull();
  });

  it("Don't let in returns after 10s, waits while focus is inside, and Scan next returns at once", async () => {
    api.checkInTicket.mockResolvedValue({ outcome: "invalid" });
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    await advance(5000);
    act(() => within(slot()).getByRole("button", { name: "Scan next" }).focus());
    await advance(20_000);
    expect(within(slot()).getByText("Don’t let in")).toBeInTheDocument();
    act(() => input().focus());
    await advance(4999);
    expect(within(slot()).getByText("Don’t let in")).toBeInTheDocument();
    await advance(1);
    expect(slot().querySelector("[data-result]")).toBeNull();

    await typeAndCheck("7KQM-2HXD");
    fireEvent.click(within(slot()).getByRole("button", { name: "Scan next" }));
    await advance();
    expect(slot().querySelector("[data-result]")).toBeNull();
  });

  it("refreshes the counts a second after a result, and reconciles the local +1", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(1);
    api.getCheckInSummary.mockResolvedValue(summary({ checkedIn: 105 }));
    await advance(1000);
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("105")).toBeInTheDocument();
  });
});

describe("offline", () => {
  it("shows the banner while offline, still attempts scans, and on reconnect says so and refreshes", async () => {
    online = false;
    api.checkInTicket.mockRejectedValue(new ApiError(0, "x"));
    await renderPage();
    const banner = screen.getByText("You’re offline. Scans can’t be checked until you reconnect.");
    expect(banner).toHaveAttribute("role", "status");
    await typeAndCheck("7KQM-2HXD");
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    expect(within(slot()).getByText("Not verified")).toBeInTheDocument();

    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await nextFrame();
    expect(screen.queryByText("You’re offline. Scans can’t be checked until you reconnect.")).toBeNull();
    expect(statusAnnouncer()).toHaveTextContent("Back online.");
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(2);
  });
});

describe("undo", () => {
  async function openUndo() {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Undo check-in, General admission, code ends 2HXD, 8:42 pm$/ }));
    await advance();
    return screen.getByRole("dialog", { name: "Undo this check-in?" });
  }

  it("needs a reason of at least 3 characters, inline, and sends nothing", async () => {
    const dialog = await openUndo();
    const reason = within(dialog).getByLabelText("Reason");
    expect(reason).toHaveFocus();
    expect(within(dialog).getByText(/General admission · code ends 2HXD · checked in 8:42 pm\./)).toBeInTheDocument();
    fireEvent.change(reason, { target: { value: " ab " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo check-in" }));
    await advance();
    const error = within(dialog).getByText("Give a reason of at least 3 characters.");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason.getAttribute("aria-describedby")).toContain(error.id);
    expect(api.undoCheckIn).not.toHaveBeenCalled();
  });

  it("a suggestion fills the reason; undone closes, announces, counts down, refreshes and focuses Recent scans", async () => {
    api.undoCheckIn.mockResolvedValue({ outcome: "undone", checkInId: "u1", ticket: { ticketTypeName: "General admission", codeLast4: "2HXD" } });
    const dialog = await openUndo();
    const chip = within(dialog).getByRole("button", { name: "Scanned by mistake" });
    act(() => chip.focus());
    fireEvent.click(chip);
    expect(within(dialog).getByLabelText("Reason")).toHaveValue("Scanned by mistake");
    expect(chip).toHaveFocus();
    expect(api.undoCheckIn).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Undo check-in" }));
    await advance();
    expect(api.undoCheckIn).toHaveBeenCalledWith("evt-1", "c1", "Scanned by mistake", expect.any(Function));
    expect(dialog).not.toHaveAttribute("open");
    await nextFrame();
    expect(statusAnnouncer()).toHaveTextContent("Check-in undone. General admission, code ends 2HXD.");
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("99")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent scans" })).toHaveFocus();
    api.getCheckInSummary.mockResolvedValue(summary({ checkedIn: 99, recent: [logEntry({ checkInId: "u1", result: "undone", undoable: false, reason: "Scanned by mistake" }), logEntry({ undoable: false })] }));
    await advance(1000);
    expect(api.getCheckInSummary).toHaveBeenCalledTimes(2);
    expect(screen.getByText("General admission · Code ends 2HXD · Reason: Scanned by mistake")).toBeInTheDocument();
  });

  it("already undone: closes and says so", async () => {
    api.undoCheckIn.mockResolvedValue({ outcome: "not_checked_in", ticket: { ticketTypeName: "General admission", codeLast4: "2HXD" } });
    const dialog = await openUndo();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Letting them back in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo check-in" }));
    await advance();
    await nextFrame();
    expect(statusAnnouncer()).toHaveTextContent("That check-in was already undone.");
    expect(within(screen.getByRole("region", { name: "Count" })).getByText("100")).toBeInTheDocument();
  });

  it.each([
    ["superseded", () => api.undoCheckIn.mockResolvedValue({ outcome: "superseded", ticket: { ticketTypeName: "GA", codeLast4: "2HXD" } }), "This ticket was checked in again since. Close this and undo the newer check-in instead."],
    ["404", () => api.undoCheckIn.mockRejectedValue(new ApiError(404, "x")), "That check-in can’t be found. Refresh the list and try again."],
    ["429", () => api.undoCheckIn.mockRejectedValue(new ApiError(429, "x")), "Too many scans and undos right now. Wait a few seconds and try again."],
    ["network", () => api.undoCheckIn.mockRejectedValue(new ApiError(0, "x")), "Couldn’t undo. Nothing changed. Check your connection and try again."],
    ["401", () => api.undoCheckIn.mockRejectedValue(new ApiError(401, "x")), "You’ve been signed out. Sign in again to undo."],
  ])("%s: stays open with a notice", async (_label, arrange, text) => {
    arrange();
    const dialog = await openUndo();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Wrong ticket scanned" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo check-in" }));
    await advance();
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByText(text, { exact: false })).toBeInTheDocument();
  });

  it("server field error: shown inline", async () => {
    api.undoCheckIn.mockRejectedValue(new ApiError(400, "x", { reason: "Reason can't contain links." }));
    const dialog = await openUndo();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "see http://x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo check-in" }));
    await advance();
    expect(within(dialog).getByText("Reason can't contain links.")).toBeInTheDocument();
  });

  it("Keep it closes without undoing", async () => {
    const dialog = await openUndo();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await advance();
    expect(dialog).not.toHaveAttribute("open");
    expect(api.undoCheckIn).not.toHaveBeenCalled();
  });
});

describe("recent scans", () => {
  it("lists entries with their labels; Refresh reloads (busy meanwhile)", async () => {
    api.getCheckInSummary.mockResolvedValue(
      summary({ recent: [logEntry(), logEntry({ checkInId: "c2", result: "invalid", codeLast4: null, ticketTypeName: null, undoable: false })] }),
    );
    await renderPage();
    const list = screen.getByRole("region", { name: "Recent scans" });
    expect(within(list).getByText("Checked in")).toBeInTheDocument();
    expect(within(list).getByText("Not valid")).toBeInTheDocument();
    expect(within(list).getByText("Code not recorded")).toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    const pending = deferred<ReturnType<typeof summary>>();
    api.getCheckInSummary.mockReturnValue(pending.promise);
    fireEvent.click(within(list).getByRole("button", { name: "Refresh" }));
    await advance();
    expect(within(list).getByRole("button", { name: "Refresh" })).toHaveAttribute("aria-disabled", "true");
    pending.resolve(summary({ recent: [logEntry({ checkInId: "c3" }), ...summary().recent] }));
    await advance();
    expect(within(list).getByRole("button", { name: "Refresh" })).not.toHaveAttribute("aria-disabled");
  });

  it("only rows new since the last list fade in (opacity only; off under reduced motion)", async () => {
    await renderPage();
    const list = screen.getByRole("region", { name: "Recent scans" });
    expect(list.querySelectorAll(".fade-in")).toHaveLength(0);
    api.getCheckInSummary.mockResolvedValue(summary({ recent: [logEntry({ checkInId: "c3", result: "invalid", codeLast4: null, ticketTypeName: null, undoable: false }), logEntry()] }));
    fireEvent.click(within(list).getByRole("button", { name: "Refresh" }));
    await advance();
    const faded = list.querySelectorAll(".fade-in");
    expect(faded).toHaveLength(1);
    expect(faded[0]).toHaveTextContent("Not valid");
  });
});

describe("settings", () => {
  it("defaults: Vibrate on (where the phone can), Sound off; remembered on this device", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    await renderPage();
    const vibrateToggle = screen.getByRole("button", { name: "Vibrate" });
    const soundToggle = screen.getByRole("button", { name: "Sound" });
    expect(vibrateToggle).toHaveAttribute("aria-pressed", "true");
    expect(soundToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(vibrateToggle);
    expect(vibrateToggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem("sheltuh:door-vibrate")).toBe("false");
    fireEvent.click(soundToggle);
    expect(window.localStorage.getItem("sheltuh:door-sound")).toBe("true");
  });

  it("vibrates per result while on, not while off", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    api.checkInTicket.mockResolvedValueOnce(admitted).mockResolvedValueOnce({ outcome: "invalid" });
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(vibrate).toHaveBeenLastCalledWith([80]);
    fireEvent.click(screen.getByRole("button", { name: "Vibrate" }));
    await typeAndCheck("ABCD-EFGH");
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("refusal and Not verified have their own patterns", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    api.checkInTicket.mockResolvedValueOnce({ outcome: "invalid" }).mockRejectedValueOnce(new ApiError(0, "x"));
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    expect(vibrate).toHaveBeenLastCalledWith([120, 80, 120, 80, 120]);
    await typeAndCheck("ABCD-EFGH");
    expect(vibrate).toHaveBeenLastCalledWith([300, 150, 300]);
  });

  it("hides Vibrate where the browser can't (iPhone)", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: "Vibrate" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sound" })).toBeInTheDocument();
  });

  it("a stored setting is read back", async () => {
    window.localStorage.setItem("sheltuh:door-sound", "true");
    await renderPage();
    expect(screen.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "true");
  });

  it("works when storage throws (private mode, blocked)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await renderPage();
    const sound = screen.getByRole("button", { name: "Sound" });
    expect(sound).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sound);
    expect(sound).toHaveAttribute("aria-pressed", "true");
  });
});

describe("motion", () => {
  it("the only animation (new Recent-scans rows) is off under reduced motion", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");
    const safe = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  @keyframes rise");
    expect(safe).toBeGreaterThan(-1);
    const fade = css.indexOf(".fade-in {");
    expect(fade).toBeGreaterThan(safe);
    // Still inside that block: no other top-level rule starts between them.
    expect(css.slice(safe, fade)).not.toMatch(/\n\}\n/);
  });

  it("result panels appear with no animation or transition", async () => {
    api.checkInTicket.mockResolvedValue({ outcome: "invalid" });
    await renderPage();
    await typeAndCheck("7KQM-2HXD");
    const panel = slot().querySelector("[data-result]");
    expect(panel?.className).not.toMatch(/\b(animate|transition|fade|rise|motion-)/);
  });
});
