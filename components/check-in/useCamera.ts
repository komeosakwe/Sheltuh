"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { loadQrDetector, type QrDetector } from "@/lib/check-in/detector";
import { isInsideReticle, reticleInVideo } from "@/lib/check-in/frame-dedupe";
import { DOOR_TIMING } from "@/lib/check-in/timing";
import { requestScreenWakeLock, type ScreenWakeLock } from "@/lib/check-in/wake-lock";

/** docs/design/check-in.md §5.A3 states. */
export type CameraState =
  | "idle"
  | "starting"
  | "live"
  | "paused"
  | "stopped"
  | "denied"
  | "insecure"
  | "unsupported"
  | "no-camera"
  | "busy"
  | "load-failed";

type Support = "ok" | "insecure" | "unsupported" | "unknown";

const noSubscribe = () => () => {};

function cameraSupport(): Support {
  if (!window.isSecureContext) return "insecure";
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return "unsupported";
  return "ok";
}

/** getUserMedia's error, read for the slot. */
function stateForCameraError(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-camera";
  return "busy";
}

/** A track that can switch a torch on (Android Chrome with a flash). */
function hasTorch(track: MediaStreamTrack): boolean {
  if (typeof track.getCapabilities !== "function") return false;
  const capabilities: object = track.getCapabilities();
  return "torch" in capabilities && capabilities.torch === true;
}

interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

/** Decode failures in a row before the scanner is treated as broken. */
const MAX_DECODE_FAILURES = 5;

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The scanner slot, for mapping the reticle onto the frame. */
  slotRef: RefObject<HTMLElement | null>;
  /** A QR code was decoded inside the reticle. */
  onDecode: (raw: string) => void;
  /** False while decodes would be ignored anyway (a request in flight, Not verified showing). */
  accepting: boolean;
}

/**
 * The rear camera and the decode loop: started only by a tap, about eight
 * decodes a second, screen kept awake while live, and stopped (Paused)
 * whenever the page is hidden.
 */
export function useCamera({ videoRef, slotRef, onDecode, accepting }: Options) {
  const support = useSyncExternalStore(noSubscribe, cameraSupport, (): Support => "unknown");
  const [state, setState] = useState<CameraState>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stream = useRef<MediaStream | null>(null);
  const wakeLock = useRef<ScreenWakeLock | null>(null);
  const loopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Bumped by every start and stop, so a superseded start or decode does nothing. */
  const generation = useRef(0);
  const stateRef = useRef<CameraState>("idle");
  const acceptingRef = useRef(accepting);
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    acceptingRef.current = accepting;
    onDecodeRef.current = onDecode;
  }, [accepting, onDecode]);

  const update = useCallback((next: CameraState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Stops the stream, the loop and the wake lock. */
  const release = useCallback(() => {
    generation.current += 1;
    clearTimeout(loopTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    void wakeLock.current?.release();
    wakeLock.current = null;
    setTorchAvailable(false);
    setTorchOn(false);
  }, [videoRef]);

  const runLoop = useCallback(
    (detector: QrDetector, mine: number) => {
      let failures = 0;
      const tick = async () => {
        if (generation.current !== mine) return;
        const video = videoRef.current;
        if (acceptingRef.current && video && video.readyState >= 2 && video.videoWidth > 0) {
          try {
            const codes = await detector.detect(video);
            failures = 0;
            if (generation.current !== mine) return;
            const slot = slotRef.current?.getBoundingClientRect();
            const reticle = reticleInVideo(
              { width: video.videoWidth, height: video.videoHeight },
              { width: slot?.width ?? 0, height: slot?.height ?? 0 },
            );
            const hit = codes.find((code) => isInsideReticle(code.boundingBox, reticle));
            if (hit) onDecodeRef.current(hit.rawValue);
          } catch {
            failures += 1;
            if (failures >= MAX_DECODE_FAILURES && generation.current === mine) {
              release();
              update("load-failed");
              return;
            }
          }
        }
        if (generation.current === mine) loopTimer.current = setTimeout(tick, DOOR_TIMING.decodeIntervalMs);
      };
      loopTimer.current = setTimeout(tick, DOOR_TIMING.decodeIntervalMs);
    },
    [release, slotRef, update, videoRef],
  );

  /** Start (or resume, or try again). Resolves once live or in an error state. */
  const start = useCallback(async (): Promise<CameraState> => {
    release();
    const mine = generation.current;
    update("starting");
    const detectorLoad = loadQrDetector();
    // Handled below; this stops an unhandled rejection if the camera fails first.
    detectorLoad.catch(() => undefined);

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (error) {
      if (generation.current !== mine) return stateRef.current;
      const next = stateForCameraError(error);
      update(next);
      return next;
    }
    if (generation.current !== mine) {
      media.getTracks().forEach((track) => track.stop());
      return stateRef.current;
    }
    stream.current = media;

    let detector: QrDetector;
    try {
      detector = await detectorLoad;
    } catch {
      if (generation.current !== mine) return stateRef.current;
      release();
      update("load-failed");
      return "load-failed";
    }
    if (generation.current !== mine) return stateRef.current;
    if (document.visibilityState === "hidden") {
      release();
      update("paused");
      return "paused";
    }

    const video = videoRef.current;
    if (video) {
      video.srcObject = media;
      try {
        await video.play();
      } catch {
        // autoPlay + muted + playsInline normally covers this; frames still decode once it plays.
      }
    }
    if (generation.current !== mine) return stateRef.current;
    const track = media.getVideoTracks()[0];
    setTorchAvailable(track ? hasTorch(track) : false);
    update("live");
    void requestScreenWakeLock().then((lock) => {
      if (generation.current === mine) wakeLock.current = lock;
      else void lock?.release();
    });
    runLoop(detector, mine);
    return "live";
  }, [release, runLoop, update, videoRef]);

  /** The person turned the camera off. */
  const stop = useCallback(() => {
    release();
    update("stopped");
  }, [release, update]);

  const toggleTorch = useCallback(async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    const torch: TorchConstraintSet = { torch: next };
    try {
      await track.applyConstraints({ advanced: [torch] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  // Leaving the page (another app, the lock screen, another tab) stops the camera.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "hidden") return;
      if (stateRef.current === "live" || stateRef.current === "starting") {
        release();
        update("paused");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [release, update]);

  useEffect(() => release, [release]);

  const shown: CameraState = support === "insecure" || support === "unsupported" ? support : state;
  return { state: shown, start, stop, torchAvailable, torchOn, toggleTorch };
}
