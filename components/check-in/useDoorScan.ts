"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { checkInTicket } from "@/lib/api/check-ins";
import type { GetToken } from "@/lib/api/client";
import type { CheckInResult } from "@/lib/api/types";
import { toneOf, unverifiedReason, type DoorResult, type DoorScan } from "@/lib/check-in/door-copy";
import { classifyDecode, SameCodeFilter } from "@/lib/check-in/frame-dedupe";
import { DOOR_TIMING } from "@/lib/check-in/timing";

/** What fills the scanner slot above the camera. */
export type ScanDisplay =
  | { kind: "none" }
  /** A request is in flight. `showText` turns on after 250ms. */
  | { kind: "checking"; code: string; showText: boolean }
  /** `retrying`: Retry was pressed and its request is in flight; the panel stays. */
  | { kind: "result"; id: number; result: DoorResult; retrying: boolean };

/** How a manual submission ended, for the input: cleared after a result, kept when Not verified. */
export type ManualOutcome = "verified" | "unverified" | "ignored";

interface Options {
  eventId: string;
  getToken: GetToken;
  /** Every result as it appears: sound, vibration and the announcement. */
  onResultShown: (result: DoorResult) => void;
  /** Every server answer (not foreign codes or failures): refresh counters, count admissions. */
  onServerResult: (result: CheckInResult) => void;
  /** The panel is about to go while focus is inside it: put focus somewhere sensible. */
  onPanelFocusLost: () => void;
  /** The result panel element, to tell whether focus is inside it. */
  panelRef: RefObject<HTMLElement | null>;
}

function minimumHold(result: DoorResult): number {
  const tone = toneOf(result);
  return tone === "admit" ? DOOR_TIMING.admitHoldMs : tone === "refuse" ? DOOR_TIMING.refuseHoldMs : Infinity;
}

function returnAfter(result: DoorResult): number | null {
  const tone = toneOf(result);
  return tone === "admit" ? DOOR_TIMING.admitReturnMs : tone === "refuse" ? DOOR_TIMING.refuseReturnMs : null;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

/** Rejects with the signal's reason when it aborts, so a hung token refresh can't outlast the timeout. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/**
 * The door scanner's scan rules (docs/design/check-in.md §5.A4): one request
 * at a time, an 8s timeout, "Checking…" only after 250ms, minimum holds,
 * auto-return, same-code suppression for 3s, Not verified until resolved,
 * and Retry with the scan's own request id.
 */
export function useDoorScan({ eventId, getToken, onResultShown, onServerResult, onPanelFocusLost, panelRef }: Options) {
  const [display, setDisplayState] = useState<ScanDisplay>({ kind: "none" });
  const [inFlight, setInFlightState] = useState(false);
  const [paused, setPaused] = useState(false);

  const displayRef = useRef<ScanDisplay>(display);
  const inFlightRef = useRef(false);
  const shownAt = useRef(0);
  const nextId = useRef(0);
  const [filter] = useState(() => new SameCodeFilter(DOOR_TIMING.sameCodeMs));
  const ownAdmissions = useRef(new Map<string, number>());
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const remaining = useRef<{ id: number; ms: number }>({ id: -1, ms: 0 });

  const callbacks = useRef({ onResultShown, onServerResult, onPanelFocusLost });
  useEffect(() => {
    callbacks.current = { onResultShown, onServerResult, onPanelFocusLost };
  }, [onResultShown, onServerResult, onPanelFocusLost]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const setDisplay = useCallback(
    (next: ScanDisplay) => {
      const current = displayRef.current;
      const leavingPanel = current.kind === "result" && (next.kind !== "result" || next.id !== current.id);
      if (leavingPanel && panelRef.current?.contains(document.activeElement)) callbacks.current.onPanelFocusLost();
      displayRef.current = next;
      setDisplayState(next);
      if (next.kind !== "result") setPaused(false);
    },
    [panelRef],
  );

  const setInFlight = useCallback((value: boolean) => {
    inFlightRef.current = value;
    setInFlightState(value);
  }, []);

  const present = useCallback(
    (result: DoorResult, key: string) => {
      const now = Date.now();
      filter.markShown(key, now);
      shownAt.current = now;
      nextId.current += 1;
      setPaused(false);
      setDisplay({ kind: "result", id: nextId.current, result, retrying: false });
      callbacks.current.onResultShown(result);
    },
    [filter, setDisplay],
  );

  const send = useCallback(
    async (scan: DoorScan, retry: boolean): Promise<ManualOutcome> => {
      setInFlight(true);
      let checkingTimer: ReturnType<typeof setTimeout> | undefined;
      const current = displayRef.current;
      if (retry && current.kind === "result") {
        setDisplay({ ...current, retrying: true });
      } else {
        // The current panel goes at once: the frame shows before the next result.
        setDisplay({ kind: "checking", code: scan.code, showText: false });
        checkingTimer = setTimeout(() => {
          const now = displayRef.current;
          if (now.kind === "checking" && now.code === scan.code) setDisplay({ ...now, showText: true });
        }, DOOR_TIMING.checkingDelayMs);
      }

      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(
        () => abort.abort(new DOMException("The check-in took too long.", "TimeoutError")),
        DOOR_TIMING.requestTimeoutMs,
      );
      const key = `ticket:${scan.code}`;
      try {
        const result = await Promise.race([
          checkInTicket(eventId, scan.code, scan.requestId, getToken, abort.signal),
          untilAborted(abort.signal),
        ]);
        if (!mounted.current) return "ignored";
        const now = Date.now();
        const ownAt = ownAdmissions.current.get(scan.code);
        const ownAgoMs =
          result.outcome === "already_checked_in" && ownAt !== undefined && now - ownAt < DOOR_TIMING.ownScanWindowMs
            ? now - ownAt
            : null;
        if (result.outcome === "admitted") ownAdmissions.current.set(scan.code, now);
        setInFlight(false);
        present({ kind: "server", scan, result, ownAgoMs }, key);
        callbacks.current.onServerResult(result);
        return "verified";
      } catch (error) {
        if (!mounted.current) return "ignored";
        setInFlight(false);
        present({ kind: "unverified", scan, reason: unverifiedReason(error) }, key);
        return "unverified";
      } finally {
        clearTimeout(timeout);
        clearTimeout(checkingTimer);
        if (controller.current === abort) controller.current = null;
      }
    },
    [eventId, getToken, present, setDisplay, setInFlight],
  );

  /** A decode from the camera (raw QR text). Ignored unless it's a new scan the rules allow. */
  const submitDecoded = useCallback(
    (raw: string) => {
      if (inFlightRef.current) return;
      const now = Date.now();
      const current = displayRef.current;
      if (current.kind === "result" && now - shownAt.current < minimumHold(current.result)) return;
      const decoded = classifyDecode(raw);
      if (filter.shouldIgnore(decoded.key, now)) return;
      if (decoded.kind === "foreign") {
        setDisplay({ kind: "none" });
        present({ kind: "foreign" }, decoded.key);
        return;
      }
      void send({ code: decoded.code, requestId: newRequestId() }, false);
    },
    [filter, present, send, setDisplay],
  );

  /** A typed code (already canonical). Retypes the Not-verified code to retry it. */
  const submitManual = useCallback(
    async (code: string): Promise<ManualOutcome> => {
      if (inFlightRef.current) return "ignored";
      const current = displayRef.current;
      if (current.kind === "result" && current.result.kind === "unverified" && current.result.scan.code === code) {
        return send(current.result.scan, true);
      }
      return send({ code, requestId: newRequestId() }, false);
    },
    [send],
  );

  /** Retry the Not-verified scan with its own request id. */
  const retry = useCallback(() => {
    const current = displayRef.current;
    if (inFlightRef.current || current.kind !== "result" || current.result.kind !== "unverified") return;
    void send(current.result.scan, true);
  }, [send]);

  /** "Scan next" / "Scan another": back to the viewfinder. */
  const dismiss = useCallback(() => {
    if (displayRef.current.kind === "result") setDisplay({ kind: "none" });
  }, [setDisplay]);

  // Auto-return to the viewfinder, paused while focus or a pointer is in the panel.
  useEffect(() => {
    if (display.kind !== "result" || paused) return;
    const total = returnAfter(display.result);
    if (total === null) return;
    const wait = remaining.current.id === display.id ? remaining.current.ms : total;
    const startedAt = Date.now();
    const id = display.id;
    const timer = setTimeout(() => {
      const now = displayRef.current;
      if (now.kind === "result" && now.id === id) setDisplay({ kind: "none" });
    }, wait);
    return () => {
      clearTimeout(timer);
      remaining.current = { id, ms: Math.max(0, wait - (Date.now() - startedAt)) };
    };
  }, [display, paused, setDisplay]);

  /** Whether camera decodes can be accepted right now (saves decoding work while they can't). */
  const acceptingDecodes = !inFlight && !(display.kind === "result" && display.result.kind === "unverified");

  return { display, inFlight, acceptingDecodes, submitDecoded, submitManual, retry, dismiss, setPaused };
}
