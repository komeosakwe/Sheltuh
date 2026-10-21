"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCheckInSummary } from "@/lib/api/check-ins";
import type { GetToken } from "@/lib/api/client";
import type { CheckInSummary } from "@/lib/api/types";
import { DOOR_TIMING } from "@/lib/check-in/timing";
import { useVisibleInterval } from "@/lib/use-visible-interval";

interface SummaryState {
  summary: CheckInSummary | null;
  /** The first load failed (nothing to show yet). */
  firstError: unknown;
  /** A refresh after the first success failed: the last numbers stay. */
  refreshFailed: boolean;
  /** When the numbers on screen were last loaded (ISO). */
  updatedAt: string | null;
}

const INITIAL: SummaryState = { summary: null, firstError: null, refreshFailed: false, updatedAt: null };

/**
 * The counters and recent log (docs/design/check-in.md §5.A1 data rules):
 * loaded on mount, polled every 15s while the page is visible, refreshed
 * (debounced) after every result and undo, and adjusted locally at once on
 * an admission or undo.
 */
export function useCheckInSummary(eventId: string, getToken: GetToken) {
  const [state, setState] = useState<SummaryState>(INITIAL);
  const [refreshing, setRefreshing] = useState(false);
  const started = useRef(0);
  const applied = useRef(0);
  /** Responses to requests started before a local adjustment are stale: the debounced refresh reconciles. */
  const staleBefore = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    started.current += 1;
    const mine = started.current;
    try {
      const summary = await getCheckInSummary(eventId, getToken);
      if (mine < staleBefore.current || mine < applied.current) return;
      applied.current = mine;
      setState({ summary, firstError: null, refreshFailed: false, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (mine < applied.current) return;
      setState((prev) => (prev.summary ? { ...prev, refreshFailed: true } : { ...prev, firstError: error }));
    }
  }, [eventId, getToken]);

  useEffect(() => {
    void load();
    return () => clearTimeout(debounce.current);
  }, [load]);

  useVisibleInterval(load, DOOR_TIMING.pollMs, { enabled: state.summary !== null });

  /** After a result or undo: one refresh a second later, however many happen in between. */
  const scheduleRefresh = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(), DOOR_TIMING.refreshDebounceMs);
  }, [load]);

  /** The Refresh button: straight away, busy while it runs. */
  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /** The first load failed and the person asked to try again. */
  const retryFirstLoad = useCallback(() => {
    setState(INITIAL);
    void load();
  }, [load]);

  /** An admission (+1) or undo (−1) shows at once, before the refresh confirms it. */
  const adjustCheckedIn = useCallback((delta: number) => {
    staleBefore.current = started.current + 1;
    setState((prev) =>
      prev.summary ? { ...prev, summary: { ...prev.summary, checkedIn: Math.max(0, prev.summary.checkedIn + delta) } } : prev,
    );
  }, []);

  return { ...state, refreshing, scheduleRefresh, refreshNow, retryFirstLoad, adjustCheckedIn, load };
}
