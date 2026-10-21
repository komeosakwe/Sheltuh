// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CheckInPage from "@/components/check-in/CheckInPage";
import { ApiError } from "@/lib/api/client";
import type { CheckInResult } from "@/lib/api/types";
import type { DetectedCode } from "@/lib/check-in/detector";
import { admitted, advance, deferred, stubBrowser, stubDialog, summary, TICKET, useDoorClock } from "./test-utils/checkInFixtures";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The door scanner's camera: start/stop, the states, the decode loop and the
 * rules that turn decodes into scans (reticle, same-code suppression, one
 * request at a time, holds, foreign QR codes). Camera, detector and API are
 * all fakes: nothing here proves a real camera or the WASM decoder works.
 */

const api = { checkInTicket: vi.fn(), undoCheckIn: vi.fn(), getCheckInSummary: vi.fn() };
vi.mock("@/lib/api/check-ins", () => ({
  checkInTicket: (...a: unknown[]) => api.checkInTicket(...a),
  undoCheckIn: (...a: unknown[]) => api.undoCheckIn(...a),
  getCheckInSummary: (...a: unknown[]) => api.getCheckInSummary(...a),
}));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));

/** What the fake detector "sees" in the current frame. */
let frame: DetectedCode[] = [];
const detect = vi.fn(async () => frame);
const loadQrDetector = vi.fn();
vi.mock("@/lib/check-in/detector", () => ({ loadQrDetector: () => loadQrDetector() }));

/** A 640×480 frame; the slot has no layout in jsdom, so the reticle is 336px square in the middle. */
const CENTRE = { x: 270, y: 190, width: 100, height: 100 };
const CORNER = { x: 0, y: 0, width: 80, height: 80 };
const qr = (rawValue: string, boundingBox = CENTRE): DetectedCode[] => [{ rawValue, boundingBox }];

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => object;
  applyConstraints: ReturnType<typeof vi.fn>;
}
let track: FakeTrack;
let getUserMedia: ReturnType<typeof vi.fn>;
let wakeLockSentinel: { released: boolean; release: ReturnType<typeof vi.fn> };
let visibility: DocumentVisibilityState = "visible";
let uuid = 0;

function fakeStream(capabilities: object = {}) {
  track = { stop: vi.fn(), getCapabilities: () => capabilities, applyConstraints: vi.fn(async () => undefined) };
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

beforeAll(() => {
  stubDialog();
  const sources = new WeakMap<HTMLMediaElement, unknown>();
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return sources.get(this) ?? null;
    },
    set(this: HTMLMediaElement, value: unknown) {
      sources.set(this, value);
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});

beforeEach(() => {
  useDoorClock();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getCheckInSummary.mockResolvedValue(summary());
  stubBrowser();
  frame = [];
  detect.mockClear();
  loadQrDetector.mockReset().mockResolvedValue({ kind: "wasm", detect });
  getUserMedia = vi.fn(async () => fakeStream());
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  wakeLockSentinel = { released: false, release: vi.fn(async () => undefined) };
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request: vi.fn(async () => wakeLockSentinel) },
  });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  uuid = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    uuid += 1;
    return `00000000-0000-4000-8000-${String(uuid).padStart(12, "0")}`;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderPage() {
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <CheckInPage eventId="evt-1" />
    </FakeAuthProvider>,
  );
  await advance();
}

const slot = () => screen.getByRole("region", { name: "Scanner" });
const resultOf = () => slot().querySelector("[data-result]")?.getAttribute("data-result") ?? null;

async function startCamera() {
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await advance();
}

/** Puts `codes` in front of the camera for one decode tick (125ms). */
async function show(codes: DetectedCode[]) {
  frame = codes;
  await advance(125);
  frame = [];
}

describe("starting and stopping", () => {
  it("starts only on a tap: rear camera, no audio, scrolled to the top instantly, Stop focused, announced, screen kept awake", async () => {
    await renderPage();
    expect(getUserMedia).not.toHaveBeenCalled();
    await startCamera();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
    expect(screen.getByRole("button", { name: "Stop camera" })).toHaveFocus();
    await advance(40);
    expect(screen.getByTestId("status-announcer")).toHaveTextContent("Camera on. Hold the ticket’s QR code inside the frame.");
    expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen");
  });

  it("keeps focus while starting: Start camera hands it to the busy Starting… button, then to Stop camera", async () => {
    const media = deferred<ReturnType<typeof fakeStream>>();
    getUserMedia.mockReturnValue(media.promise);
    await renderPage();
    const start = screen.getByRole("button", { name: "Start camera" });
    act(() => start.focus());
    fireEvent.click(start);
    await advance();
    const starting = within(slot()).getByRole("button", { name: "Starting…" });
    expect(starting).toHaveFocus();
    expect(starting).toHaveAttribute("aria-disabled", "true");
    media.resolve(fakeStream());
    await advance();
    expect(screen.getByRole("button", { name: "Stop camera" })).toHaveFocus();
  });

  it("Stop camera: stops the stream and wake lock, says so, and focuses Start camera", async () => {
    await renderPage();
    await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    await advance(40);
    expect(track.stop).toHaveBeenCalled();
    expect(wakeLockSentinel.release).toHaveBeenCalled();
    expect(within(slot()).getByRole("heading", { name: "Camera off" })).toBeInTheDocument();
    expect(screen.getByText("You can still type codes below.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start camera" })).toHaveFocus();
    expect(screen.getByTestId("status-announcer")).toHaveTextContent("Camera off.");
  });

  it("stops when the page is hidden and offers Resume", async () => {
    await renderPage();
    await startCamera();
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance();
    expect(track.stop).toHaveBeenCalled();
    expect(wakeLockSentinel.release).toHaveBeenCalled();
    expect(within(slot()).getByRole("heading", { name: "Camera paused" })).toBeInTheDocument();
    visibility = "visible";
    fireEvent.click(screen.getByRole("button", { name: "Resume camera" }));
    await advance();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Stop camera" })).toBeInTheDocument();
  });

  it("offers the torch only when the camera has one, as a pressed toggle", async () => {
    getUserMedia.mockImplementation(async () => fakeStream({ torch: true }));
    await renderPage();
    await startCamera();
    const torch = screen.getByRole("button", { name: "Torch" });
    expect(torch).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(torch);
    await advance();
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(screen.getByRole("button", { name: "Torch" })).toHaveAttribute("aria-pressed", "true");
  });

  it("no torch control without one", async () => {
    await renderPage();
    await startCamera();
    expect(screen.queryByRole("button", { name: "Torch" })).toBeNull();
  });
});

describe("camera problems", () => {
  it.each([
    ["NotAllowedError", "Camera access is blocked", "Try again", "Allow the camera for this site, then tap Try again. Until then, type codes below."],
    ["NotReadableError", "The camera is in use", "Try again", "Close any other app using the camera, then try again."],
    ["NotFoundError", "No camera found", null, "Type codes below."],
    ["OverconstrainedError", "No camera found", null, "Type codes below."],
  ])("%s: %s, focused and announced", async (name, title, button, body) => {
    getUserMedia.mockRejectedValue(new DOMException("x", name));
    await renderPage();
    act(() => screen.getByRole("button", { name: "Start camera" }).focus());
    await startCamera();
    // Focus lands on the heading (never dropped to the page), and the problem is said politely.
    const heading = within(slot()).getByRole("heading", { name: title });
    expect(heading).toHaveFocus();
    await advance(40);
    const status = screen.getByTestId("status-announcer");
    expect(status).toHaveTextContent(`${title}. ${body}`);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("result-announcer")).toHaveTextContent("");
    if (button) expect(within(slot()).getByRole("button", { name: button })).toBeInTheDocument();
    else expect(within(slot()).queryByRole("button")).toBeNull();
    // Typing still works.
    expect(screen.getByLabelText("Type a code")).toBeEnabled();
  });

  it("blocked: says how to allow it on iPhone and Android, and Try again asks again", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    await renderPage();
    await startCamera();
    expect(screen.getByText(/Website Settings › Camera › Allow\./)).toBeInTheDocument();
    expect(screen.getByText(/Permissions › Camera › Allow\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await advance();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Stop camera" })).toHaveFocus();
  });

  it("scanner failed to load: says so, focuses the heading, and lets the camera go", async () => {
    loadQrDetector.mockRejectedValue(new Error("wasm 404"));
    await renderPage();
    await startCamera();
    expect(within(slot()).getByRole("heading", { name: "The scanner couldn’t load" })).toHaveFocus();
    expect(screen.getByText("Check your connection and try again, or type codes below.")).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
  });

  it("the scanner failing while live: focus goes from the vanished Stop camera to the heading, and it's announced", async () => {
    await renderPage();
    await startCamera();
    expect(screen.getByRole("button", { name: "Stop camera" })).toHaveFocus();
    // Five failed decodes in a row (MAX_DECODE_FAILURES) and the scanner is treated as broken.
    for (let i = 0; i < 5; i += 1) detect.mockRejectedValueOnce(new Error("decoder crashed"));
    await advance(125 * 5);
    const heading = within(slot()).getByRole("heading", { name: "The scanner couldn’t load" });
    expect(heading).toHaveFocus();
    await advance(40);
    expect(screen.getByTestId("status-announcer")).toHaveTextContent(
      "The scanner couldn’t load. Check your connection and try again, or type codes below.",
    );
  });

  it("unsupported browser (no camera API): explains, never offers Start", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await renderPage();
    expect(within(slot()).getByRole("heading", { name: "This browser can’t use the camera here" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start camera" })).toBeNull();
    expect(screen.getByLabelText("Type a code")).toBeEnabled();
  });

  it("insecure page: explains https, never offers Start", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    await renderPage();
    expect(within(slot()).getByRole("heading", { name: "The camera needs a secure connection" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start camera" })).toBeNull();
  });
});

describe("decoding", () => {
  it("decodes about 8 times a second and checks in a Sheltüh QR inside the frame", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await startCamera();
    await advance(1000);
    expect(detect.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(detect.mock.calls.length).toBeLessThanOrEqual(9);
    await show(qr("SH1:7KQM-2HXD"));
    expect(api.checkInTicket).toHaveBeenCalledWith(
      "evt-1",
      "7KQM-2HXD",
      "00000000-0000-4000-8000-000000000001",
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(resultOf()).toBe("admit");
  });

  it("ignores a code whose centre is outside the reticle (a poster at the edge)", async () => {
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD", CORNER));
    expect(api.checkInTicket).not.toHaveBeenCalled();
  });

  it("a QR that isn't a Sheltüh ticket: refused locally, nothing sent", async () => {
    await renderPage();
    await startCamera();
    await show(qr("https://example.com/menu"));
    expect(api.checkInTicket).not.toHaveBeenCalled();
    expect(resultOf()).toBe("refuse");
    expect(within(slot()).getByText("Not a Sheltüh ticket")).toBeInTheDocument();
    expect(
      within(slot()).getByText("This QR code isn’t a Sheltüh ticket. Ask for the ticket email or the Sheltüh confirmation page."),
    ).toBeInTheDocument();
    await advance(40);
    expect(screen.getByTestId("result-announcer")).toHaveTextContent("Don’t let in. Not a Sheltüh ticket.");
  });

  it("the same code is ignored for 3s after its result, then scans again (Already checked in, on this device)", async () => {
    api.checkInTicket.mockResolvedValueOnce(admitted);
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    // Still in front of the camera: ignored, even after Let in returns to the viewfinder (2.5s).
    frame = qr("SH1:7KQM-2HXD");
    await advance(2800);
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    api.checkInTicket.mockResolvedValueOnce({ outcome: "already_checked_in", ticket: TICKET, checkedInAt: new Date().toISOString() });
    await advance(300);
    frame = [];
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
    expect(api.checkInTicket.mock.calls[1][2]).not.toBe(api.checkInTicket.mock.calls[0][2]);
    expect(within(slot()).getByText("Checked in on this device 3 sec ago.")).toBeInTheDocument();
  });

  it("one request at a time: decodes while it's in flight are ignored", async () => {
    const pending = deferred<CheckInResult>();
    api.checkInTicket.mockReturnValue(pending.promise);
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    await show(qr("SH1:ABCD-EFGH"));
    await show(qr("https://example.com"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    expect(resultOf()).toBeNull();
    pending.resolve(admitted);
    await advance();
    expect(resultOf()).toBe("admit");
  });

  it("Don't let in holds 2s against a different code, then takes it", async () => {
    api.checkInTicket.mockResolvedValueOnce({ outcome: "invalid" }).mockResolvedValueOnce(admitted);
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    expect(resultOf()).toBe("refuse");
    await advance(1500);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    await advance(500);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
    expect(resultOf()).toBe("admit");
  });

  it("Let in holds 1s against a different code", async () => {
    api.checkInTicket.mockResolvedValue(admitted);
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    await advance(500);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    await advance(500);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
  });

  it("Not verified ignores the camera until it's resolved, so the person in front isn't lost", async () => {
    api.checkInTicket.mockRejectedValueOnce(new ApiError(0, "x"));
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    expect(resultOf()).toBe("hold");
    await advance(10_000);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(1);
    expect(resultOf()).toBe("hold");
    // The Stop control under the panel is out of the focus order.
    expect(screen.getByRole("button", { name: "Stop camera" }).closest("[inert]")).not.toBeNull();
    fireEvent.click(within(slot()).getByRole("button", { name: "Scan another" }));
    await advance();
    api.checkInTicket.mockResolvedValueOnce(admitted);
    await show(qr("SH1:ABCD-EFGH"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
  });

  it("the same code back in front of the camera after Scan another resends the unresolved scan's request id", async () => {
    api.checkInTicket.mockRejectedValueOnce(new ApiError(0, "x"));
    await renderPage();
    await startCamera();
    await show(qr("SH1:7KQM-2HXD"));
    expect(resultOf()).toBe("hold");
    await advance(5000);
    fireEvent.click(within(slot()).getByRole("button", { name: "Scan another" }));
    await advance();
    api.checkInTicket.mockResolvedValueOnce(admitted);
    await show(qr("SH1:7KQM-2HXD"));
    expect(api.checkInTicket).toHaveBeenCalledTimes(2);
    expect(api.checkInTicket.mock.calls[1][2]).toBe(api.checkInTicket.mock.calls[0][2]);
    expect(resultOf()).toBe("admit");
  });

  it("stops decoding when the camera stops", async () => {
    await renderPage();
    await startCamera();
    fireEvent.click(screen.getByRole("button", { name: "Stop camera" }));
    await advance();
    detect.mockClear();
    await advance(1000);
    expect(detect).not.toHaveBeenCalled();
  });
});
