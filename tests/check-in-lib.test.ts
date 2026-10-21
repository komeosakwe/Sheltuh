import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { CheckInLogEntry, CheckInResult } from "@/lib/api/types";
import {
  canRetry,
  checkedInPercent,
  formatCheckedInAt,
  recentRow,
  relativeAgo,
  resultAnnouncement,
  toneOf,
  undoAbout,
  unverifiedReason,
  type DoorResult,
  type UnverifiedReason,
} from "@/lib/check-in/door-copy";
import { UnresolvedScans } from "@/components/check-in/useDoorScan";
import { classifyDecode, isInsideReticle, reticleInVideo, reticleSide, SameCodeFilter } from "@/lib/check-in/frame-dedupe";
import { normaliseTypedCode } from "@/lib/check-in/manual-code";
import { requestScreenWakeLock } from "@/lib/check-in/wake-lock";

const scan = { code: "7KQM-2HXD", requestId: "11111111-1111-4111-8111-111111111111" };
const ticket = { ticketTypeName: "General admission", ticketNumber: 2, ticketCount: 3, codeLast4: "2HXD" };

describe("normaliseTypedCode (manual entry)", () => {
  it.each([
    ["7KQM-2HXD", "7KQM-2HXD"],
    ["7kqm2hxd", "7KQM-2HXD"],
    ["  7kqm 2hxd ", "7KQM-2HXD"],
    ["SH1:7KQM-2HXD", "7KQM-2HXD"],
    ["sh1:7kqm2hxd", "7KQM-2HXD"],
    ["7K-QM-2H-XD", "7KQM-2HXD"],
  ])("accepts %j as %s", (raw, code) => {
    expect(normaliseTypedCode(raw)).toBe(code);
  });

  it.each([[""], ["7KQM-2HX"], ["7KQM-2HXDA"], ["7KQM-2HX0"], ["OKQM-2HXD"], ["1KQM-2HXD"], ["IKQM-2HXD"], ["hello world"], ["SH2:7KQM-2HXD"]])(
    "refuses %j",
    (raw) => {
      expect(normaliseTypedCode(raw)).toBeNull();
    },
  );
});

describe("classifyDecode", () => {
  it("reads a Sheltüh QR (with the prefix) or a bare code as a ticket", () => {
    expect(classifyDecode("SH1:7KQM-2HXD")).toEqual({ kind: "ticket", code: "7KQM-2HXD", key: "ticket:7KQM-2HXD" });
    expect(classifyDecode("7kqm-2hxd")).toEqual({ kind: "ticket", code: "7KQM-2HXD", key: "ticket:7KQM-2HXD" });
  });

  it("treats anything else as someone else's QR", () => {
    expect(classifyDecode("https://example.com")).toEqual({ kind: "foreign", key: "foreign:https://example.com" });
  });
});

describe("reticle", () => {
  it("is a centred square, as wide as the on-screen reticle, mapped through object-cover", () => {
    // 1280×720 video in a 4:3 slot of 400×300: scale = max(400/1280, 300/720) = 0.4167. The reticle is
    // 196px there (300 − 104 for the controls band, under 70% = 210), so 196 / 0.4167 = 470.4 video px.
    const r = reticleInVideo({ width: 1280, height: 720 }, { width: 400, height: 300 });
    expect(r.width).toBeCloseTo(470.4);
    expect(r.height).toBeCloseTo(470.4);
    expect(r.x).toBeCloseTo((1280 - 470.4) / 2);
    expect(r.y).toBeCloseTo((720 - 470.4) / 2);
  });

  it("is 70% of the slot's shorter side, but stays clear of the Stop camera / Torch band on phones", () => {
    // Tablet and desktop (1:1 slot): plain 70%.
    expect(reticleSide({ width: 380, height: 380 })).toBeCloseTo(266);
    expect(reticleSide({ width: 540, height: 540 })).toBeCloseTo(378);
    // Phones (4:3): 320 → 288×216 and 375 → 343×257.25, each the slot less two 52px bands.
    expect(reticleSide({ width: 288, height: 216 })).toBeCloseTo(112);
    expect(reticleSide({ width: 343, height: 257.25 })).toBeCloseTo(153.25);
    // A very short slot (landscape) never drops below half its shorter side.
    expect(reticleSide({ width: 600, height: 150 })).toBeCloseTo(75);
  });

  it("falls back to the frame itself when the slot has no size", () => {
    expect(reticleInVideo({ width: 1000, height: 500 }, { width: 0, height: 0 })).toEqual({ x: 325, y: 75, width: 350, height: 350 });
  });

  it("counts a code only if its centre is inside", () => {
    const r = { x: 100, y: 100, width: 100, height: 100 };
    expect(isInsideReticle({ x: 120, y: 120, width: 40, height: 40 }, r)).toBe(true);
    expect(isInsideReticle({ x: 0, y: 0, width: 40, height: 40 }, r)).toBe(false);
    // A poster at the edge, partly overlapping, centre outside.
    expect(isInsideReticle({ x: 180, y: 100, width: 60, height: 60 }, r)).toBe(false);
  });
});

describe("SameCodeFilter", () => {
  it("ignores the same code within the window of its result, not after, and not other codes", () => {
    const filter = new SameCodeFilter(3000);
    filter.markShown("ticket:A", 10_000);
    expect(filter.shouldIgnore("ticket:A", 12_999)).toBe(true);
    expect(filter.shouldIgnore("ticket:A", 13_000)).toBe(false);
    expect(filter.shouldIgnore("ticket:B", 10_500)).toBe(false);
  });
});

describe("UnresolvedScans", () => {
  it("keeps a Not-verified scan's request id for its code, for the window, until a definite answer", () => {
    const ids = vi.spyOn(crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");
    const unresolved = new UnresolvedScans(60_000);
    unresolved.remember(scan, 1000);
    expect(unresolved.scanFor(scan.code, 60_999)).toEqual(scan);
    expect(unresolved.scanFor("ABCD-EFGH", 2000).requestId).toBe("22222222-2222-4222-8222-222222222222");
    expect(unresolved.scanFor(scan.code, 61_000).requestId).toBe("22222222-2222-4222-8222-222222222222");
    unresolved.remember(scan, 70_000);
    unresolved.resolve(scan.code);
    expect(unresolved.scanFor(scan.code, 70_001).requestId).toBe("22222222-2222-4222-8222-222222222222");
    ids.mockRestore();
  });
});

describe("door copy", () => {
  it("names each result's tone", () => {
    expect(toneOf({ kind: "server", scan, result: { outcome: "admitted", ticket }, ownAgoMs: null })).toBe("admit");
    expect(toneOf({ kind: "server", scan, result: { outcome: "invalid" }, ownAgoMs: null })).toBe("refuse");
    expect(toneOf({ kind: "foreign" })).toBe("refuse");
    expect(toneOf({ kind: "unverified", scan, reason: "network" })).toBe("hold");
  });

  it("fails closed on an outcome it doesn't know: Not verified, never Let in", () => {
    const unknown = { outcome: "admitted_vip", ticket } as unknown as CheckInResult;
    const result: DoorResult = { kind: "server", scan, result: unknown, ownAgoMs: null };
    expect(toneOf(result)).toBe("hold");
    expect(resultAnnouncement(result)).toBe("Not verified. Don’t let in yet. Reload the page, then check the code again.");
    const entry = { checkInId: "c1", result: "teleported", at: "2026-10-17T09:42:00.000Z", codeLast4: "2HXD", ticketTypeName: "General admission", undoable: false };
    expect(recentRow(entry as unknown as CheckInLogEntry)).toEqual({
      label: "Unknown result",
      detail: "General admission · Code ends 2HXD",
      icon: "cross",
    });
  });

  it("announces each result with the exact §5.A8 strings", () => {
    const at = "2026-10-17T09:42:00.000Z"; // 8:42 pm in Melbourne (AEDT)
    const results: [DoorResult, string][] = [
      [{ kind: "server", scan, result: { outcome: "admitted", ticket }, ownAgoMs: null }, "Let in. General admission, ticket 2 of 3."],
      [
        { kind: "server", scan, result: { outcome: "already_checked_in", ticket, checkedInAt: at }, ownAgoMs: null },
        "Don’t let in. Already checked in at 8:42 pm.",
      ],
      [{ kind: "server", scan, result: { outcome: "not_admissible", ticket }, ownAgoMs: null }, "Don’t let in. Ticket void."],
      [
        { kind: "server", scan, result: { outcome: "other_event", ticket, otherEventTitle: "Night Market" }, ownAgoMs: null },
        "Don’t let in. Ticket for Night Market.",
      ],
      [{ kind: "server", scan, result: { outcome: "invalid" }, ownAgoMs: null }, "Don’t let in. Not a valid ticket."],
      [{ kind: "foreign" }, "Don’t let in. Not a Sheltüh ticket."],
      [
        { kind: "unverified", scan, reason: "rate-limited" },
        "Not verified. Don’t let in yet. Too many scans. Wait a few seconds, then retry.",
      ],
    ];
    for (const [result, text] of results) expect(resultAnnouncement(result)).toBe(text);
  });

  it("says why a scan wasn't verified, and mentions retrying only where Retry is offered", () => {
    const spoken: [UnverifiedReason, string][] = [
      ["network", "Not verified. Don’t let in yet. Couldn’t reach Sheltüh. Retry when you have signal."],
      ["rate-limited", "Not verified. Don’t let in yet. Too many scans. Wait a few seconds, then retry."],
      ["server", "Not verified. Don’t let in yet. Sheltüh had a problem. Retry in a moment."],
      ["signed-out", "Not verified. Don’t let in yet. You’ve been signed out. Sign in again."],
      ["no-access", "Not verified. Don’t let in yet. This account can’t check people in for this event."],
      ["unsendable", "Not verified. Don’t let in yet. This scan couldn’t be sent. Type the code instead."],
    ];
    for (const [reason, text] of spoken) {
      const said = resultAnnouncement({ kind: "unverified", scan, reason });
      expect(said).toBe(text);
      expect(/retry/i.test(said)).toBe(canRetry(reason));
    }
  });

  it("gives a bar's share of what's sold, capped, and 0 when nothing has sold", () => {
    expect(checkedInPercent(100, 180)).toBeCloseTo(55.56, 2);
    expect(checkedInPercent(5, 4)).toBe(100);
    expect(checkedInPercent(3, 0)).toBe(0);
  });

  it("reads thrown errors as reasons it couldn't verify", () => {
    expect(unverifiedReason(new ApiError(0, "x"))).toBe("network");
    expect(unverifiedReason(new DOMException("t", "TimeoutError"))).toBe("network");
    expect(unverifiedReason(new DOMException("a", "AbortError"))).toBe("network");
    expect(unverifiedReason(new ApiError(429, "x"))).toBe("rate-limited");
    expect(unverifiedReason(new ApiError(503, "x"))).toBe("server");
    expect(unverifiedReason(new ApiError(401, "x"))).toBe("signed-out");
    expect(unverifiedReason(new ApiError(403, "x"))).toBe("no-access");
    expect(unverifiedReason(new ApiError(404, "x"))).toBe("no-access");
    expect(unverifiedReason(new ApiError(400, "x"))).toBe("unsendable");
    expect(unverifiedReason(new ApiError(413, "x"))).toBe("unsendable");
    expect(canRetry("network")).toBe(true);
    expect(canRetry("unsendable")).toBe(false);
  });

  it("says how long ago, then the day once it's a day old", () => {
    expect(relativeAgo(59_000)).toBe("just now");
    expect(relativeAgo(14 * 60_000)).toBe("14 min ago");
    expect(relativeAgo(65 * 60_000)).toBe("1 hr 5 min ago");
    expect(relativeAgo(120 * 60_000)).toBe("2 hr ago");
    const at = "2026-10-17T09:42:00.000Z";
    expect(formatCheckedInAt(at, new Date("2026-10-17T09:56:00.000Z"))).toBe("8:42 pm (14 min ago)");
    expect(formatCheckedInAt(at, new Date("2026-10-18T10:00:00.000Z"))).toBe("Sat 17 Oct, 8:42 pm");
  });

  it("labels Recent-scans rows per §5.A9", () => {
    const base: CheckInLogEntry = {
      checkInId: "c1",
      result: "admitted",
      at: "2026-10-17T09:42:00.000Z",
      codeLast4: "2HXD",
      ticketTypeName: "General admission",
      undoable: true,
    };
    expect(recentRow(base)).toEqual({ label: "Checked in", detail: "General admission · Code ends 2HXD", icon: "check" });
    expect(recentRow({ ...base, result: "already_checked_in" }).label).toBe("Already checked in");
    expect(recentRow({ ...base, result: "not_admissible" }).label).toBe("Void");
    expect(recentRow({ ...base, result: "other_event", otherEventTitle: "Night Market" })).toEqual({
      label: "Wrong event",
      detail: "For Night Market · Code ends 2HXD",
      icon: "cross",
    });
    expect(recentRow({ ...base, result: "invalid", codeLast4: null, ticketTypeName: null })).toEqual({
      label: "Not valid",
      detail: "Code not recorded",
      icon: "cross",
    });
    expect(recentRow({ ...base, result: "undone", reason: "Scanned by mistake" })).toEqual({
      label: "Undone",
      detail: "General admission · Code ends 2HXD · Reason: Scanned by mistake",
      icon: "undo",
    });
    expect(undoAbout(base)).toBe("General admission · code ends 2HXD · checked in 8:42 pm");
  });
});

describe("requestScreenWakeLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is null, without throwing, when there's no Wake Lock API or it refuses", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestScreenWakeLock()).resolves.toBeNull();
    vi.stubGlobal("navigator", { wakeLock: { request: () => Promise.reject(new DOMException("no", "NotAllowedError")) } });
    await expect(requestScreenWakeLock()).resolves.toBeNull();
  });

  it("releases once, quietly", async () => {
    const sentinel = { released: false, release: vi.fn(async () => undefined) };
    vi.stubGlobal("navigator", { wakeLock: { request: vi.fn(async () => sentinel) } });
    const lock = await requestScreenWakeLock();
    await lock?.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});
