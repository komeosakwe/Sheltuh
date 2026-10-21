"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { doorBusyClass } from "./busy-class";
import type { CameraState } from "./useCamera";
import DoorIcon from "./DoorIcon";

const stateLayerClass = "relative [grid-area:1/1] flex flex-col justify-center gap-3 bg-surface p-4 sm:p-6";

/**
 * The reticle (§4): a centred square, 70% of the slot's shorter side, drawn
 * as four static L-shaped corners with 24px arms. A 4px light stroke over a
 * 6px dark one gives the 1px dark edge that reads over bright and dark video.
 * On phones it shrinks to stay clear of the controls band (max-h: the slot
 * less 6.5rem, two 44px pills plus their 8px inset), never below half the
 * slot. Must match `reticleSide` (lib/check-in/frame-dedupe.ts), which sets
 * the decode region.
 */
function Reticle() {
  const corners = ["top-0 left-0", "top-0 right-0 rotate-90", "right-0 bottom-0 rotate-180", "bottom-0 left-0 -rotate-90"];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative aspect-square h-[70%] max-h-[calc(100%-6.5rem)] min-h-[50%] max-w-[70%]">
        {corners.map((position) => (
          <svg key={position} viewBox="0 0 24 24" fill="none" strokeLinecap="square" className={`absolute size-6 ${position}`}>
            <path d="M2 22V2h20" stroke="var(--background)" strokeWidth="6" />
            <path d="M2 22V2h20" stroke="var(--foreground)" strokeWidth="4" />
          </svg>
        ))}
      </div>
    </div>
  );
}

interface Props {
  camera: {
    state: CameraState;
    torchAvailable: boolean;
    torchOn: boolean;
  };
  videoRef: RefObject<HTMLVideoElement | null>;
  slotRef: RefObject<HTMLElement | null>;
  startButtonRef: RefObject<HTMLButtonElement | null>;
  stopButtonRef: RefObject<HTMLButtonElement | null>;
  stateHeadingRef: RefObject<HTMLHeadingElement | null>;
  onStart: () => void;
  onStop: () => void;
  onToggleTorch: () => void;
  /** The Checking layer or a result panel, drawn over the camera. */
  overlay: ReactNode;
}

/**
 * The scanner slot (docs/design/check-in.md §5.A3): one grid cell holding
 * the video box, the camera state layer and the overlay, so long copy grows
 * the slot instead of clipping.
 */
export default function Scanner({
  camera,
  videoRef,
  slotRef,
  startButtonRef,
  stopButtonRef,
  stateHeadingRef,
  onStart,
  onStop,
  onToggleTorch,
  overlay,
}: Props) {
  const { state } = camera;
  const live = state === "live";
  const covered = overlay !== null;
  const videoBoxRef = useRef<HTMLDivElement>(null);

  const stateLayerRef = useRef<HTMLDivElement>(null);

  // A panel covering the camera controls (Stop camera, Start camera, Try
  // again) takes them out of the focus order, so focus is never hidden under
  // it; if focus was on one, keep it in the slot rather than the page.
  useEffect(() => {
    if (!covered) return;
    const active = document.activeElement;
    if (videoBoxRef.current?.contains(active) || stateLayerRef.current?.contains(active)) slotRef.current?.focus();
  }, [covered, slotRef]);

  return (
    <section
      ref={slotRef}
      aria-label="Scanner"
      tabIndex={-1}
      className="relative grid outline-offset-2"
    >
      <div
        ref={videoBoxRef}
        inert={covered || !live}
        className="relative [grid-area:1/1] aspect-[4/3] max-h-[60svh] w-full overflow-hidden bg-surface md:aspect-square"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-hidden="true"
          className={`size-full object-cover ${live ? "" : "hidden"}`.trim()}
        />
        {live && <Reticle />}
        {live && (
          <div className="absolute right-2 bottom-2 flex gap-2">
            {camera.torchAvailable && (
              <Button
                size="sm"
                variant={camera.torchOn ? "solid" : "outline"}
                aria-pressed={camera.torchOn}
                onClick={onToggleTorch}
                className={`min-h-11 ${camera.torchOn ? "" : "bg-background"}`.trim()}
              >
                {camera.torchOn && <DoorIcon name="check" className="size-5" />}
                Torch
              </Button>
            )}
            <Button ref={stopButtonRef} size="sm" variant="outline" onClick={onStop} className="min-h-11 bg-background">
              Stop camera
            </Button>
          </div>
        )}
      </div>

      {!live && (
        <StateLayer
          layerRef={stateLayerRef}
          covered={covered}
          state={state}
          startButtonRef={startButtonRef}
          headingRef={stateHeadingRef}
          onStart={onStart}
        />
      )}

      {overlay}
    </section>
  );
}

function StateLayer({
  layerRef,
  covered,
  state,
  startButtonRef,
  headingRef,
  onStart,
}: {
  layerRef: RefObject<HTMLDivElement | null>;
  /** A result or Checking is drawn over it. */
  covered: boolean;
  state: Exclude<CameraState, "live">;
  startButtonRef: RefObject<HTMLButtonElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onStart: () => void;
}) {
  if (state === "starting") {
    return (
      <div ref={layerRef} inert={covered} className={stateLayerClass}>
        <div className="flex max-w-sm flex-col gap-3">
          <p className="text-base">Starting camera…</p>
          <div>
            <Button ref={startButtonRef} size="lg" variant="solid" busy className={doorBusyClass}>
              Starting…
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const content = STATE_COPY[state];
  return (
    <div ref={layerRef} inert={covered} className={stateLayerClass}>
      <div className="flex max-w-sm flex-col gap-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="flex items-start gap-2 font-sans text-xl leading-7 font-semibold tracking-normal normal-case outline-offset-2"
        >
          {content.icon && <DoorIcon name="alert" className="mt-1 size-5 text-danger" />}
          {content.title}
        </h2>
        <p className="text-sm text-muted">{content.body}</p>
        {state === "denied" && (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>
              iPhone: tap <strong>aA</strong> in the address bar, then Website Settings › Camera › Allow.
            </li>
            <li>Android (Chrome): tap the icon left of the address, then Permissions › Camera › Allow.</li>
          </ol>
        )}
        {content.button && (
          <div>
            <Button ref={startButtonRef} size="lg" variant="solid" onClick={onStart}>
              {content.button}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The polite announcement when the camera can't run (§5.A8): its heading and
 * body, so "No camera found" isn't silent. Null for states that aren't a
 * problem the person just ran into.
 */
export function cameraProblemAnnouncement(state: CameraState): string | null {
  if (state === "live" || state === "starting") return null;
  const content = STATE_COPY[state];
  return content.problem ? `${content.title}. ${content.body}` : null;
}

/** `problem`: a start (or the scanner) just failed, so it's announced and its heading focused. */
const STATE_COPY: Record<
  Exclude<CameraState, "live" | "starting">,
  { title: string; body: string; button?: string; problem?: boolean; icon?: boolean }
> = {
  idle: {
    title: "Scan tickets with your camera",
    body: "Your browser will ask to use the camera. Nothing is recorded: only the ticket code is sent to check it.",
    button: "Start camera",
  },
  paused: {
    title: "Camera paused",
    body: "The camera stops when you leave this page.",
    button: "Resume camera",
  },
  stopped: { title: "Camera off", body: "You can still type codes below.", button: "Start camera" },
  denied: {
    title: "Camera access is blocked",
    body: "Allow the camera for this site, then tap Try again. Until then, type codes below.",
    button: "Try again",
    problem: true,
    icon: true,
  },
  insecure: {
    title: "The camera needs a secure connection",
    body: "Browsers only allow the camera on addresses starting with https://. Open this page that way, or type codes below.",
  },
  unsupported: {
    title: "This browser can’t use the camera here",
    body: "Open this page in Safari (iPhone) or Chrome (Android), or type codes below.",
  },
  "no-camera": { title: "No camera found", body: "Type codes below.", problem: true },
  busy: {
    title: "The camera is in use",
    body: "Close any other app using the camera, then try again.",
    button: "Try again",
    problem: true,
  },
  "load-failed": {
    title: "The scanner couldn’t load",
    body: "Check your connection and try again, or type codes below.",
    button: "Try again",
    problem: true,
  },
};
