/**
 * Turning camera decodes into scans (docs/design/check-in.md §4, §5.A4):
 * only codes centred inside the on-screen reticle count, and the same code
 * seen again within a few seconds of its result is ignored.
 */
import { parseTicketCode } from "@/lib/ticket-code";
import type { DetectedBox } from "./detector";

/** The reticle's side as a share of the scanner slot's shorter side. */
export const RETICLE_RATIO = 0.7;

/**
 * Height kept clear for the live controls (Torch, Stop camera: 44px pills
 * 8px from the bottom edge), above and below the centred reticle so the pills
 * never cover a corner: 2 × (44 + 8). Scanner.tsx's reticle uses the same
 * figure (6.5rem).
 */
export const RETICLE_CONTROLS_CLEARANCE_PX = 104;

/** The reticle never shrinks below this share of the slot's shorter side (very short landscape slots). */
export const RETICLE_MIN_RATIO = 0.5;

export interface Size {
  width: number;
  height: number;
}

/**
 * The reticle's side in the slot's CSS pixels: `ratio` of the shorter side,
 * but short enough to stay clear of the controls band (on phones, where the
 * 4:3 slot is only 216px tall at 320), and never under `RETICLE_MIN_RATIO`.
 */
export function reticleSide(slot: Size, ratio = RETICLE_RATIO): number {
  const shorter = Math.min(slot.width, slot.height);
  return Math.max(RETICLE_MIN_RATIO * shorter, Math.min(ratio * shorter, slot.height - RETICLE_CONTROLS_CLEARANCE_PX));
}

/**
 * The reticle in the video's own pixels. The video fills the slot with
 * `object-cover` (scaled up to cover, centred, edges cropped), and the
 * reticle is a centred square `reticleSide(slot)` across.
 * Without a laid-out slot (0×0), it's taken relative to the frame itself.
 */
export function reticleInVideo(video: Size, slot: Size, ratio = RETICLE_RATIO): DetectedBox {
  let side: number;
  if (slot.width > 0 && slot.height > 0) {
    const scale = Math.max(slot.width / video.width, slot.height / video.height);
    side = reticleSide(slot, ratio) / scale;
  } else {
    side = ratio * Math.min(video.width, video.height);
  }
  return { x: (video.width - side) / 2, y: (video.height - side) / 2, width: side, height: side };
}

/** Whether a decoded code's bounding-box centre falls inside the reticle. */
export function isInsideReticle(box: DetectedBox, reticle: DetectedBox): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= reticle.x && cx <= reticle.x + reticle.width && cy >= reticle.y && cy <= reticle.y + reticle.height;
}

/** A decode, read: a Sheltüh ticket code (canonical), or some other QR code. */
export type DecodedScan = { kind: "ticket"; code: string; key: string } | { kind: "foreign"; key: string };

/**
 * What a decoded QR payload is. Anything `parseTicketCode` refuses is
 * "foreign": shown locally as "Not a Sheltüh ticket", never sent (§7
 * proposal 1). `key` identifies it for same-code suppression.
 */
export function classifyDecode(raw: string): DecodedScan {
  const code = parseTicketCode(raw);
  return code ? { kind: "ticket", code, key: `ticket:${code}` } : { kind: "foreign", key: `foreign:${raw}` };
}

/**
 * Remembers when each code's result appeared, so the same code still in
 * front of the camera doesn't scan again for `windowMs`.
 */
export class SameCodeFilter {
  private shown = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /** A result for `key` appeared at `now`. */
  markShown(key: string, now: number): void {
    this.shown.set(key, now);
    // Keep it small: nothing older than the window matters.
    for (const [k, at] of this.shown) if (now - at >= this.windowMs) this.shown.delete(k);
  }

  /** Whether a decode of `key` at `now` should be ignored. */
  shouldIgnore(key: string, now: number): boolean {
    const at = this.shown.get(key);
    return at !== undefined && now - at < this.windowMs;
  }
}
