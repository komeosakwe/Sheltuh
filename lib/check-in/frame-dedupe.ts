/**
 * Turning camera decodes into scans (docs/design/check-in.md §4, §5.A4):
 * only codes centred inside the on-screen reticle count, and the same code
 * seen again within a few seconds of its result is ignored.
 */
import { parseTicketCode } from "@/lib/ticket-code";
import type { DetectedBox } from "./detector";

/** The reticle's side as a share of the scanner slot's shorter side. */
export const RETICLE_RATIO = 0.7;

export interface Size {
  width: number;
  height: number;
}

/**
 * The reticle in the video's own pixels. The video fills the slot with
 * `object-cover` (scaled up to cover, centred, edges cropped), and the
 * reticle is a centred square `RETICLE_RATIO` of the slot's shorter side.
 * Without a laid-out slot (0×0), it's taken relative to the frame itself.
 */
export function reticleInVideo(video: Size, slot: Size, ratio = RETICLE_RATIO): DetectedBox {
  let side: number;
  if (slot.width > 0 && slot.height > 0) {
    const scale = Math.max(slot.width / video.width, slot.height / video.height);
    side = (ratio * Math.min(slot.width, slot.height)) / scale;
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
