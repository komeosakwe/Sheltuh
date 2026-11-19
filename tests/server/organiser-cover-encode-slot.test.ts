import type { Sharp, SharpInput, SharpOptions } from "sharp";
import type sharpType from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AVATAR_ENCODE_CONCURRENCY, inEncodeSlot } from "@/lib/server/avatar";
import { COVER_SIZE, COVER_SMALL_SIZE, encodeCover } from "@/lib/server/organiser-cover";

// encodeCover runs its two WebP encodes side by side inside a decode slot
// (lib/server/organiser-cover.ts). If one fails early, the slot mustn't be
// handed on while the other is still running in libvips: the slots exist to
// bound how much decoding/encoding runs at once (AVATAR_ENCODE_CONCURRENCY).
//
// The WebP encodes (sharp called on raw pixels) are replaced, in this file
// only, with ones the test settles by hand; everything else is real sharp.

const encodes = vi.hoisted(() => ({
  /** When set, a WebP encode of raw pixels to `width` returns this instead of encoding. */
  raw: undefined as undefined | ((width: number) => Promise<Buffer>),
}));

vi.mock("sharp", async (importOriginal) => {
  const actual = (await importOriginal<{ default: typeof sharpType }>()).default;
  function sharp(input?: SharpInput | SharpInput[], options?: SharpOptions) {
    const raw = encodes.raw;
    if (raw && options?.raw) {
      let width = 0;
      const pipeline = {
        resize(w: number) {
          width = w;
          return pipeline;
        },
        webp: () => pipeline,
        toBuffer: () => raw(width),
      };
      return pipeline as unknown as Sharp;
    }
    return actual(input, options);
  }
  return { default: sharp };
});

/** Lets every pending callback, timer and libvips completion run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("encodeCover's decode slot", () => {
  it("isn't handed on until both WebP encodes have settled, even when one fails first", async () => {
    expect(AVATAR_ENCODE_CONCURRENCY.running).toBe(2);
    const actual = (await vi.importActual<{ default: typeof sharpType }>("sharp")).default;
    const png = await actual({ create: { width: 64, height: 64, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();

    let finishLarge: ((out: Buffer) => void) | undefined;
    let smallFailed!: () => void;
    const smallHasFailed = new Promise<void>((resolve) => (smallFailed = resolve));
    encodes.raw = (width) => {
      if (width === COVER_SIZE.width) return new Promise<Buffer>((resolve) => (finishLarge = resolve));
      expect(width).toBe(COVER_SMALL_SIZE.width);
      smallFailed();
      return Promise.reject(new Error("small encode failed"));
    };

    let releaseBlocker: (() => void) | undefined;
    try {
      // The cover takes one slot, a blocker the other; a third job queues for a turn.
      let coverSettled = false;
      const cover = encodeCover(png).finally(() => (coverSettled = true));
      cover.catch(() => undefined);
      const blocker = inEncodeSlot(() => new Promise<void>((resolve) => (releaseBlocker = resolve)));
      let queuedStarted = false;
      const queued = inEncodeSlot(async () => {
        queuedStarted = true;
      });

      await smallHasFailed;
      await settle();
      // The small encode has failed, the large one is still running: the slot is still held.
      expect(coverSettled).toBe(false);
      expect(queuedStarted).toBe(false);

      finishLarge?.(Buffer.from("webp"));
      await expect(cover).rejects.toThrow("small encode failed");
      await queued;
      expect(queuedStarted).toBe(true);

      releaseBlocker?.();
      await blocker;
    } finally {
      // Even when an assertion fails, release the test's pending work so no slot stays held.
      finishLarge?.(Buffer.from("webp"));
      releaseBlocker?.();
      encodes.raw = undefined;
    }
  });
});
