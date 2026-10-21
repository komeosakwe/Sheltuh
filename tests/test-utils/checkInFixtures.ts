import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { CheckInLogEntry, CheckInResult, CheckInSummary } from "@/lib/api/types";

/** Fixed "now" for the door tests: 8:56 pm in Melbourne (AEDT), Sat 17 Oct 2026. */
export const NOW = new Date("2026-10-17T09:56:00.000Z");
/** 8:42 pm, 14 minutes before NOW. */
export const EARLIER = "2026-10-17T09:42:00.000Z";

export const TICKET = { ticketTypeName: "General admission", ticketNumber: 2, ticketCount: 3, codeLast4: "2HXD" };

export function logEntry(overrides: Partial<CheckInLogEntry> = {}): CheckInLogEntry {
  return {
    checkInId: "c1",
    result: "admitted",
    at: EARLIER,
    codeLast4: "2HXD",
    ticketTypeName: "General admission",
    undoable: true,
    ...overrides,
  };
}

export function summary(overrides: Partial<CheckInSummary> = {}): CheckInSummary {
  return {
    event: { eventId: "evt-1", title: "Night Market", startsAt: "2026-10-17T08:00:00.000Z", endsAt: "2026-10-17T12:00:00.000Z" },
    checkedIn: 100,
    ticketsSold: 240,
    capacity: 300,
    byTicketType: [{ ticketTypeId: "tt1", name: "General admission", checkedIn: 100, ticketsSold: 180, capacity: 200 }],
    recent: [logEntry()],
    ...overrides,
  };
}

export const admitted: CheckInResult = { outcome: "admitted", checkInId: "c9", ticket: TICKET, checkedInAt: NOW.toISOString() };

/** Fake timers for everything the scanner schedules, starting at NOW. */
export function useDoorClock() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  vi.setSystemTime(NOW);
}

/** Lets promises settle and timers due within `ms` run, inside act. */
export async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A promise you settle later. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** jsdom has no modal dialogs: give <dialog> what a browser would. */
export function stubDialog() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

/** A secure page whose browser has a camera API (or not). */
export function stubBrowser({ secure = true, online = true }: { secure?: boolean; online?: boolean } = {}) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: secure });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.scrollTo = vi.fn();
}
