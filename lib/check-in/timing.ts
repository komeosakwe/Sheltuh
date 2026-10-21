/**
 * Every door-scanner timing in one place (docs/design/check-in.md §5.A4,
 * §5.A1, §5.A2, §5.A3). With these holds no result panel can change more
 * than once a second (WCAG 2.3.1).
 */
export const DOOR_TIMING = {
  /** "Let in": new camera scans are ignored this long. */
  admitHoldMs: 1000,
  /** "Let in" goes back to the viewfinder after this long. */
  admitReturnMs: 2500,
  /** "Don't let in": new camera scans are ignored this long. */
  refuseHoldMs: 2000,
  /** "Don't let in" goes back to the viewfinder after this long. */
  refuseReturnMs: 10_000,
  /** The same code decoded again within this long of its result appearing is ignored. */
  sameCodeMs: 3000,
  /** "Checking…" only shows if no answer has come after this long (no flicker on fast responses). */
  checkingDelayMs: 250,
  /** A scan request is aborted after this long: Not verified. */
  requestTimeoutMs: 8000,
  /** An already-checked-in ticket this device admitted within this long gets "Checked in on this device…". */
  ownScanWindowMs: 60_000,
  /** Counters refresh this long after a result or an undo (bursts collapse into one request). */
  refreshDebounceMs: 1000,
  /** Counters refresh this often while the page is visible. */
  pollMs: 15_000,
  /** The polite count announcement waits this long for the number to settle. */
  countAnnounceDebounceMs: 1500,
  /** About 8 decodes a second. */
  decodeIntervalMs: 125,
} as const;

/** Vibration patterns (Android only; iOS Safari has no navigator.vibrate). */
export const DOOR_VIBRATION = {
  admit: [80],
  refuse: [120, 80, 120, 80, 120],
  hold: [300, 150, 300],
} as const;

/** Square-wave tones (Hz, ms per beep, how many, gap ms). */
export const DOOR_TONES = {
  admit: { hz: 1046, ms: 120, count: 1, gapMs: 0 },
  refuse: { hz: 330, ms: 180, count: 2, gapMs: 80 },
  hold: { hz: 660, ms: 90, count: 3, gapMs: 60 },
} as const;
