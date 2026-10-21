"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { NotApprovedOrganiser } from "@/components/analytics/AnalyticsGate";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import { undoCheckIn } from "@/lib/api/check-ins";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { CheckInLogEntry, CheckInResult } from "@/lib/api/types";
import { resultAnnouncement, toneOf, type DoorResult } from "@/lib/check-in/door-copy";
import { canVibrate, DoorSound, vibrateFor } from "@/lib/check-in/feedback";
import { withNext } from "@/lib/safe-next-path";
import { CheckInCounters, CheckInTitle } from "./CheckInHeader";
import DoorSettings from "./DoorSettings";
import DoorTicketTypes from "./DoorTicketTypes";
import HowCheckInWorks from "./HowCheckInWorks";
import ManualEntry from "./ManualEntry";
import OfflineBanner, { useOnline } from "./OfflineBanner";
import RecentScans from "./RecentScans";
import ResultPanel from "./ResultPanel";
import Scanner, { cameraProblemAnnouncement } from "./Scanner";
import UndoCheckInDialog, { undoErrorOutcome, type UndoDialogOutcome } from "./UndoCheckInDialog";
import { useAnnouncer } from "./useAnnouncer";
import { useCamera } from "./useCamera";
import { useCheckInSummary } from "./useCheckInSummary";
import { SOUND_PREF_KEY, useDoorPref, VIBRATE_PREF_KEY } from "./useDoorPref";
import { useDoorScan } from "./useDoorScan";

const noSubscribe = () => () => {};

export const pageClass = "mx-auto w-full max-w-xl px-4 pt-2 pb-12 sm:px-6 md:max-w-6xl md:px-8 md:pt-4 md:pb-16";

/** The page's path, for sign-in to come back to. */
export function checkInPath(eventId: string): string {
  return `/dashboard/${encodeURIComponent(eventId)}/check-in`;
}

type FocusTarget = "stop" | "start" | "state-heading" | "recent-heading" | null;

/**
 * The door scanner once the viewer is an approved organiser
 * (docs/design/check-in.md §5.A1–§5.A13): counters, the scanner slot, manual
 * entry, settings, ticket types, recent scans and undo.
 */
export default function DoorConsole({
  eventId,
  getToken,
  doorRef,
}: {
  eventId: string;
  getToken: GetToken;
  /** The door wrapper, scrolled to the top on Start camera. */
  doorRef: RefObject<HTMLDivElement | null>;
}) {
  const returnTo = checkInPath(eventId);
  const summary = useCheckInSummary(eventId, getToken);
  const { scheduleRefresh, adjustCheckedIn, load: reloadSummary } = summary;
  const online = useOnline();
  const [vibrateOn, setVibrateOn] = useDoorPref(VIBRATE_PREF_KEY, true);
  const [soundOn, setSoundOn] = useDoorPref(SOUND_PREF_KEY, false);
  const vibrateSupported = useSyncExternalStore(noSubscribe, canVibrate, () => false);
  const [sound] = useState(() => new DoorSound());
  const [assertive, announceAssertive] = useAnnouncer();
  const [polite, announcePolite] = useAnnouncer();
  const [undoTarget, setUndoTarget] = useState<CheckInLogEntry | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const stateHeadingRef = useRef<HTMLHeadingElement>(null);
  const recentHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget>(null);

  useEffect(() => () => sound.close(), [sound]);

  const onResultShown = useCallback(
    (result: DoorResult) => {
      const tone = toneOf(result);
      if (vibrateOn) vibrateFor(tone);
      if (soundOn) sound.play(tone);
      announceAssertive(resultAnnouncement(result));
    },
    [announceAssertive, sound, soundOn, vibrateOn],
  );

  const onServerResult = useCallback(
    (result: CheckInResult) => {
      if (result.outcome === "admitted") adjustCheckedIn(1);
      scheduleRefresh();
    },
    [adjustCheckedIn, scheduleRefresh],
  );

  const onPanelFocusLost = useCallback(() => slotRef.current?.focus(), []);

  const scan = useDoorScan({ eventId, getToken, onResultShown, onServerResult, onPanelFocusLost, panelRef });
  const camera = useCamera({ videoRef, slotRef, onDecode: scan.submitDecoded, accepting: scan.acceptingDecodes });

  // A camera problem is announced politely (focus alone only reads its heading, and "No camera found" has no
  // button to land on). If the control that had focus went with the old state (Stop camera when the scanner
  // fails while live), focus goes to the problem's heading rather than the page.
  const previousCameraState = useRef(camera.state);
  useEffect(() => {
    const before = previousCameraState.current;
    previousCameraState.current = camera.state;
    if (before === camera.state) return;
    const problem = cameraProblemAnnouncement(camera.state);
    if (!problem) return;
    announcePolite(problem);
    const active = document.activeElement;
    if (!pendingFocus.current && (active === null || active === document.body)) pendingFocus.current = "state-heading";
  }, [announcePolite, camera.state]);

  // "Checking…" (shown once a request takes over 250ms) is said politely; the result follows assertively.
  const checkingShown = scan.display.kind === "checking" && scan.display.showText;
  useEffect(() => {
    if (checkingShown) announcePolite("Checking…");
  }, [announcePolite, checkingShown]);

  // Moves focus only where §5.A13 says: Start ↔ Stop, error headings, the Recent scans heading after an undo.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element =
      target === "stop"
        ? stopButtonRef.current
        : target === "start"
          ? startButtonRef.current
          : target === "state-heading"
            ? stateHeadingRef.current
            : undoTarget === null
              ? recentHeadingRef.current
              : null;
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  // Coming back online: say so, and catch the counts up.
  useEffect(() => {
    function onOnline() {
      announcePolite("Back online.");
      void reloadSummary();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [announcePolite, reloadSummary]);

  async function startCamera() {
    if (soundOn) sound.unlock();
    const door = doorRef.current;
    if (door) window.scrollTo({ top: door.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
    // Start camera is replaced by the busy "Starting…" button: keep focus on it, not the page.
    pendingFocus.current = "start";
    const next = await camera.start();
    if (next === "live") {
      pendingFocus.current = "stop";
      announcePolite("Camera on. Hold the ticket’s QR code inside the frame.");
    } else if (next === "paused") {
      pendingFocus.current = "start";
    } else {
      // Every other outcome is a problem with a focusable heading (announced by the effect above).
      pendingFocus.current = "state-heading";
    }
  }

  function stopCamera() {
    camera.stop();
    pendingFocus.current = "start";
    announcePolite("Camera off.");
  }

  async function submitUndo(entry: CheckInLogEntry, reason: string): Promise<UndoDialogOutcome> {
    try {
      const result = await undoCheckIn(eventId, entry.checkInId, reason, getToken);
      if (result.outcome === "superseded") {
        return {
          ok: false,
          notice: "This ticket was checked in again since. Close this and undo the newer check-in instead.",
        };
      }
      if (result.outcome === "undone") {
        adjustCheckedIn(-1);
        announcePolite(`Check-in undone. ${result.ticket.ticketTypeName}, code ends ${result.ticket.codeLast4}.`);
      } else {
        announcePolite("That check-in was already undone.");
      }
      pendingFocus.current = "recent-heading";
      setUndoTarget(null);
      scheduleRefresh();
      return { ok: true };
    } catch (error) {
      return undoErrorOutcome(error);
    }
  }

  const firstError = summary.summary === null ? summary.firstError : null;
  if (firstError) {
    return (
      <div className={pageClass}>
        <FirstLoadError error={firstError} returnTo={returnTo} onRetry={summary.retryFirstLoad} />
      </div>
    );
  }

  const display = scan.display;
  const overlay =
    display.kind === "result" ? (
      <ResultPanel
        key={display.id}
        result={display.result}
        retrying={display.retrying}
        returnTo={returnTo}
        panelRef={panelRef}
        onRetry={scan.retry}
        onDismiss={scan.dismiss}
        onPauseChange={scan.setPaused}
      />
    ) : display.kind === "checking" && display.showText ? (
      <div className="relative [grid-area:1/1] flex flex-col justify-center gap-1 bg-background p-4">
        <p className="font-heading text-2xl">Checking…</p>
        <p className="text-base text-muted">Code ends {display.code.slice(-4)}</p>
      </div>
    ) : null;

  const data = summary.summary;
  return (
    <>
      <OfflineBanner online={online} />
      <div className={pageClass}>
        <CheckInTitle summary={data} />
        <div className="md:mt-6 md:grid md:grid-cols-12 md:grid-rows-[auto_auto_1fr] md:gap-x-8 md:gap-y-8">
          <div className="mt-3 md:col-span-5 md:col-start-8 md:row-start-1 md:mt-0">
            <CheckInCounters summary={data} updatedAt={summary.updatedAt} refreshFailed={summary.refreshFailed} />
          </div>
          <div className="mt-4 flex flex-col gap-4 md:col-span-7 md:col-start-1 md:row-span-2 md:row-start-1 md:mt-0">
            <Scanner
              camera={camera}
              videoRef={videoRef}
              slotRef={slotRef}
              startButtonRef={startButtonRef}
              stopButtonRef={stopButtonRef}
              stateHeadingRef={stateHeadingRef}
              onStart={() => void startCamera()}
              onStop={stopCamera}
              onToggleTorch={() => void camera.toggleTorch()}
              overlay={overlay}
            />
            <ManualEntry
              busy={scan.inFlight}
              inputRef={inputRef}
              onSubmit={scan.submitManual}
              onGesture={() => {
                if (soundOn) sound.unlock();
              }}
            />
            <DoorSettings
              vibrateSupported={vibrateSupported}
              vibrate={vibrateOn}
              sound={soundOn}
              onVibrateChange={setVibrateOn}
              onSoundChange={(on) => {
                setSoundOn(on);
                if (on) sound.unlock();
              }}
            />
          </div>
          <div className="mt-8 flex flex-col gap-8 md:col-span-5 md:col-start-8 md:row-span-2 md:row-start-2 md:mt-0">
            {data && <DoorTicketTypes types={data.byTicketType} />}
            {data && (
              <RecentScans
                entries={data.recent}
                refreshing={summary.refreshing}
                refreshFailed={summary.refreshFailed}
                headingRef={recentHeadingRef}
                onRefresh={() => void summary.refreshNow()}
                onUndo={setUndoTarget}
              />
            )}
          </div>
          <div className="mt-8 md:col-span-7 md:col-start-1 md:row-start-3 md:mt-0">
            <HowCheckInWorks />
          </div>
        </div>
      </div>

      <UndoCheckInDialog entry={undoTarget} returnTo={returnTo} onClose={() => setUndoTarget(null)} onSubmit={submitUndo} />

      <p aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="result-announcer">
        {assertive}
      </p>
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-testid="status-announcer">
        {polite}
      </p>
    </>
  );
}

/** §5.A1: the summary's first load failed, so there's nothing to check in against. */
function FirstLoadError({ error, returnTo, onRetry }: { error: unknown; returnTo: string; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  if (status === 401) {
    return (
      <EmptyState
        headingLevel={1}
        title="Sign in to check people in"
        action={
          <ButtonLink size="lg" href={withNext("/login", returnTo)}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }
  if (status === 403) {
    return (
      <>
        <h1 className="display-md mb-8">Door check-in</h1>
        <NotApprovedOrganiser need="check people in at the door" />
      </>
    );
  }
  if (status === 404) {
    return (
      <EmptyState
        headingLevel={1}
        title="Event not found"
        action={
          <ButtonLink variant="outline" size="lg" href="/dashboard">
            Back to your events
          </ButtonLink>
        }
      >
        It may have been deleted, or it belongs to another organiser account. Only the organiser who owns an event can
        check people in.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      headingLevel={1}
      title="Couldn’t load check-in"
      action={
        <Button size="lg" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      Check your connection, then try again.
    </EmptyState>
  );
}
