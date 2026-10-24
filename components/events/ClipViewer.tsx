"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import SeatDialog from "@/components/seating/SeatDialog";
import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/** Marks a Play control with its event's id (`ClipPlayButton`): a rail copy's opener hands focus to the real card's. */
export const CLIP_PLAY_ATTR = "data-clip-play";
/** The rail copies' marker (components/home/RailItem.tsx RAIL_CLONE_ATTR; not imported, so this stays out of the home bundle). */
const RAIL_CLONE_SELECTOR = "[data-rail-clone]";
/** The loader shows only if the clip hasn't started to play by then (§5.2), so a quick load never flashes it. */
export const CLIP_LOADER_DELAY_MS = 300;
export const CLIP_ERROR_TEXT = "This clip can’t play right now.";

export interface ViewerClip {
  /** The `<video>` src: the event's same-origin clip URL, or an owner's or admin's signed preview URL. */
  url: string;
  /** The clip's text alternative, shown under it and the video's description. */
  description: string;
  /** As shown, in pixels: portrait or square clips get the narrower dialog, and the box is reserved before any bytes. */
  width?: number;
  height?: number;
}

export interface ClipViewerRequest {
  /** The dialog's title: the event's. */
  title: string;
  clip: ViewerClip;
  /** The event's photo, shown until the clip plays (none for generated poster art, or a preview). */
  poster?: string;
  /** The control that opened it: focus goes back there on closing. */
  trigger?: HTMLElement | null;
}

interface ClipViewerValue {
  open: (request: ClipViewerRequest) => void;
  close: () => void;
  /** The viewer is open: the home rails hold still (useRailAutoScroll `held`). */
  isOpen: boolean;
}

const ClipViewerContext = createContext<ClipViewerValue | null>(null);

/** The page's one clip viewer, or null outside a ClipViewerProvider. */
export function useClipViewer(): ClipViewerValue | null {
  return useContext(ClipViewerContext);
}

/**
 * Where focus should be when the viewer opens, so it comes back there on
 * closing: the opener itself, unless it's in a rail copy (aria-hidden, out of
 * the tab order), in which case the real card's Play for the same event (in
 * the same rail first), never a hidden one. Null: leave focus as it is.
 */
function focusTarget(trigger: HTMLElement | null | undefined): HTMLElement | null {
  if (!trigger) return null;
  const copy = trigger.closest(RAIL_CLONE_SELECTOR);
  if (!copy) return trigger;
  const id = trigger.getAttribute(CLIP_PLAY_ATTR);
  if (id === null) return null;
  const isReal = (el: HTMLElement) => el.getAttribute(CLIP_PLAY_ATTR) === id && !el.closest(RAIL_CLONE_SELECTOR);
  const within = (root: ParentNode | null) =>
    root ? Array.from(root.querySelectorAll<HTMLElement>(`[${CLIP_PLAY_ATTR}]`)).find(isReal) ?? null : null;
  return within(copy.parentElement) ?? within(document);
}

/**
 * The clip viewer (docs/design/event-clips.md §5.2), mounted once in the
 * root layout so every page with an EventCard has it, and never inside a
 * rail copy. `open` shows SeatDialog (a bottom sheet on phones, centred from
 * 640px) with the clip; closing (Close, or Escape) unmounts the video, which
 * stops playback and buffering, and puts focus back on the opener.
 */
export function ClipViewerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ClipViewerRequest | null>(null);

  const open = useCallback((next: ClipViewerRequest) => {
    // Before showModal, so SeatDialog remembers this as the place to return to (Safari doesn't
    // focus a clicked button, and a rail copy's button must never get focus back).
    focusTarget(next.trigger)?.focus({ preventScroll: true });
    setRequest(next);
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const value = useMemo(() => ({ open, close, isOpen: request !== null }), [open, close, request]);

  const { width, height } = request?.clip ?? {};
  const portrait = Boolean(width && height && height >= width);

  return (
    <ClipViewerContext value={value}>
      {children}
      <SeatDialog open={request !== null} title={request?.title ?? ""} wide={!portrait} onClose={close}>
        {request && <ClipBody request={request} />}
      </SeatDialog>
    </ClipViewerContext>
  );
}

type Status = "loading" | "ready" | "error";

/** The video and its description. Mounted only while the dialog is open. */
function ClipBody({ request }: { request: ClipViewerRequest }) {
  const { clip, poster, title } = request;
  const reduceMotion = usePrefersReducedMotion();
  const descriptionId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Try again remounts the video (a new key) with the same src. */
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [slow, setSlow] = useState(false);
  const sized = Boolean(clip.width && clip.height);

  // The loader, only once loading has taken a moment.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setSlow(true), CLIP_LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  // It plays on opening, unless the person has asked for less motion: then the poster and the
  // controls wait for them. A refused play() (an autoplay policy) leaves the controls to them too.
  useEffect(() => {
    const video = videoRef.current;
    if (reduceMotion || !video) return;
    const playing = video.play() as Promise<void> | undefined;
    playing?.catch(() => {
      // Autoplay refused: nothing to report, the native controls are there to press.
    });
  }, [reduceMotion, attempt]);

  // After Try again the button has gone: focus the new video (its controls), or where a browser
  // won't focus a video, the dialog's title; never the page behind.
  useEffect(() => {
    const video = videoRef.current;
    if (attempt === 0 || !video) return;
    video.focus();
    if (document.activeElement !== video) video.closest("dialog")?.querySelector<HTMLElement>("h2[tabindex]")?.focus();
  }, [attempt]);

  function retry() {
    setStatus("loading");
    setSlow(false);
    setAttempt((n) => n + 1);
  }

  return (
    <>
      {status === "error" ? (
        <div data-surface="ink" data-clip-error="" className="flex flex-col items-start gap-3 rounded-control p-4">
          <p role="alert" className="text-sm leading-5">
            {CLIP_ERROR_TEXT}
          </p>
          <Button variant="outline" size="sm" className="min-h-11" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="relative flex justify-center overflow-hidden rounded-control bg-ink">
          <video
            key={attempt}
            ref={videoRef}
            src={clip.url}
            poster={poster || undefined}
            muted
            playsInline
            controls
            controlsList="nodownload"
            disablePictureInPicture
            preload={reduceMotion ? "metadata" : "auto"}
            width={sized ? clip.width : undefined}
            height={sized ? clip.height : undefined}
            aria-label={`Clip: ${title}`}
            aria-describedby={descriptionId}
            onCanPlay={() => setStatus("ready")}
            // With reduced motion nothing more loads until they press play: the header is enough.
            onLoadedMetadata={reduceMotion ? () => setStatus("ready") : undefined}
            onError={() => setStatus("error")}
            className={
              sized
                ? "mx-auto block h-auto max-h-[calc(80dvh-10rem)] w-auto max-w-full"
                : "aspect-video max-h-[calc(80dvh-10rem)] w-full object-contain"
            }
          />
          {status === "loading" && slow && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* White dots on black, over the poster (the ink scope inverts the loader). */}
              <div data-surface="ink" className="rounded-control px-3 py-2">
                <DotsLoader label="Loading clip" announce />
              </div>
            </div>
          )}
        </div>
      )}
      <p id={descriptionId} className="text-sm leading-5 break-words text-foreground">
        {clip.description}
      </p>
    </>
  );
}
