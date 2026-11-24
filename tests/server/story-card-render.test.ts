import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/server/http";
import { coverCrop } from "@/lib/server/share-card-data";
import { inStoryCardSlot, makeStoryCard, renderStoryCard, STORY_CARD_RENDER_SLOTS } from "@/lib/server/story-card-render";
import { storyCardPhoto } from "@/lib/server/story-card-photo";
import { storyCardText, type StoryCardEventFields, type StoryCardFormat } from "@/lib/story-card";

/**
 * The story card's renderer (lib/server/story-card-render.tsx, lib/server/story-card-photo.ts)
 * with the real next/og and sharp. Pixel checks only where rasterisation can't move them (the
 * flat bottom band, the tag's dot, the wordmark, empty space above a clamped title): Satori's
 * type differs from a browser's by design, so this is not a golden-image test. The look is
 * checked by eye against the design's references (scripts/preview-story-cards.ts).
 */

const RENDER_TIMEOUT = 30_000;

const EVENT: StoryCardEventFields = {
  title: "Here & Now",
  startsAt: "2026-11-14T06:00:00.000Z",
  endsAt: "2026-11-14T10:00:00.000Z",
  timeZone: "Australia/Melbourne",
  state: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
};

const samplePhoto = (file: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", "events", file)));

/** Each pixel's [r, g, b] in a region. */
async function pixelsOf(jpeg: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const { data } = await sharp(jpeg).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 3) out.push([data[i], data[i + 1], data[i + 2]]);
  return out;
}

/** The mean colour of a region (averaged here: sharp's stats() ignores extract and describes the whole input). */
async function meanOf(jpeg: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const pixels = await pixelsOf(jpeg, region);
  const sum = pixels.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b], [0, 0, 0]);
  return { r: sum[0] / pixels.length, g: sum[1] / pixels.length, b: sum[2] / pixels.length };
}

async function card(format: StoryCardFormat, photo: { bytes: Uint8Array; focus: { x: number; y: number } | null } | null, title = EVENT.title) {
  return makeStoryCard({ format, text: storyCardText({ ...EVENT, title }), tag: "In 3 days", photo });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("coverCrop (shared with the link preview)", () => {
  it("covers the size and places the crop at the focus point, as object-position does", () => {
    // 1440 × 1440 into 1080 × 1920: scaled to 1920 × 1920, 840 px to spare across.
    expect(coverCrop(1440, 1440, { width: 1080, height: 1920 }, null)).toEqual({
      resize: { width: 1920, height: 1920 },
      extract: { left: 420, top: 0, width: 1080, height: 1920 },
    });
    expect(coverCrop(1440, 1440, { width: 1080, height: 1920 }, { x: 85, y: 30 }).extract.left).toBe(714);
    expect(coverCrop(1440, 1440, { width: 1080, height: 1920 }, { x: 0, y: 0 }).extract.left).toBe(0);
    // Out-of-range focus is clamped.
    expect(coverCrop(1440, 1440, { width: 1080, height: 1920 }, { x: 150, y: -5 }).extract.left).toBe(840);
    // The link preview's size: a 1920 × 1281 photo into 1200 × 630, focus 50/30.
    expect(coverCrop(1920, 1281, { width: 1200, height: 630 }, { x: 50, y: 30 })).toEqual({
      resize: { width: 1200, height: 801 },
      extract: { left: 0, top: 51, width: 1200, height: 630 },
    });
  });
});

describe("storyCardPhoto", () => {
  it("full-bleed for a photo that covers the card without enlarging it more than 1.6 times", async () => {
    const photo = await storyCardPhoto(samplePhoto("street-market.jpg"), { x: 50, y: 30 }, "story");
    expect(photo?.mode).toBe("full-bleed");
    expect(photo?.sharp).toBeNull();
    const background = Buffer.from(photo!.background.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    expect(await sharp(background).metadata()).toMatchObject({ width: 1080, height: 1920, format: "jpeg" });
  });

  it("backdrop mode for a small photo (724 × 522): a quarter-size blurred copy and the whole photo at the card's width", async () => {
    const photo = await storyCardPhoto(samplePhoto("gallery-opening.jpg"), null, "story");
    expect(photo?.mode).toBe("backdrop");
    expect(photo?.sharp).toMatchObject({ width: 1080, height: Math.round((1080 * 522) / 724) });
    const background = Buffer.from(photo!.background.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    expect(await sharp(background).metadata()).toMatchObject({ width: 270, height: 480 });
  });

  it("reads WebP", async () => {
    const photo = await storyCardPhoto(samplePhoto("jazz-drummer.webp"), null, "square");
    expect(photo?.mode).toBe("backdrop");
  });

  it("the tone of a grey photo is the grey tone", async () => {
    const grey = await sharp({ create: { width: 1200, height: 2000, channels: 3, background: "#808080" } }).png().toBuffer();
    const photo = await storyCardPhoto(new Uint8Array(grey), null, "story");
    expect(photo?.tone).toEqual({ tone: { r: 33, g: 33, b: 33 }, light: { r: 199, g: 199, b: 199 } });
  });

  it("samples the bottom third of the crop: a photo dark-red below and blue above takes the red's hue", async () => {
    const split = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#0000ff" } })
      .composite([{ input: { create: { width: 1080, height: 700, channels: 3, background: "#800000" } }, left: 0, top: 1220 }])
      .png()
      .toBuffer();
    const { tone } = (await storyCardPhoto(new Uint8Array(split), null, "story"))!.tone;
    expect(tone.r).toBeGreaterThan(tone.b);
  });

  it("null for bytes that aren't an image, or a photo that can't be decoded (logged without details)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await storyCardPhoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), null, "story")).toBeNull();
    const truncated = samplePhoto("street-market.jpg").slice(0, 4000);
    expect(await storyCardPhoto(truncated, null, "story")).toBeNull();
    for (const call of log.mock.calls) expect(String(call[1] ?? "")).not.toMatch(/base64|data:/);
  });
});

describe("renderStoryCard / makeStoryCard", () => {
  it(
    "a story with a full-bleed photo: a 1080 × 1920 JPEG, the bottom band in the photo's tone, the orange tag dot and the white wordmark",
    async () => {
      const bytes = samplePhoto("street-market.jpg");
      const photo = (await storyCardPhoto(bytes, { x: 50, y: 30 }, "story"))!;
      const jpeg = await renderStoryCard({ format: "story", text: storyCardText(EVENT), tag: "In 3 days", photo });
      expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1920 });
      expect(jpeg.length).toBeLessThan(1.5 * 1024 * 1024);

      // Below the fade's last stop (797 px into it: y 1709 for a one-line title) there's only the tone.
      const band = await meanOf(jpeg, { left: 0, top: 1760, width: 1080, height: 160 });
      expect(Math.abs(band.r - photo.tone.tone.r)).toBeLessThanOrEqual(4);
      expect(Math.abs(band.g - photo.tone.tone.g)).toBeLessThanOrEqual(4);
      expect(Math.abs(band.b - photo.tone.tone.b)).toBeLessThanOrEqual(4);

      // The tag's first dot: 80 + 1.5 border + 20 padding across, centred in the 59 px pill from y 282.
      const dot = await meanOf(jpeg, { left: 104, top: 309, width: 5, height: 5 });
      expect(dot.r).toBeGreaterThan(215);
      expect(dot.g).toBeGreaterThan(40);
      expect(dot.g).toBeLessThan(120);
      expect(dot.b).toBeLessThan(60);

      // The wordmark: 150 × 34, right 80, top 296.
      const mark = await pixelsOf(jpeg, { left: 850, top: 296, width: 150, height: 34 });
      expect(mark.some(([r, g, b]) => Math.min(r, g, b) > 235)).toBe(true);
    },
    RENDER_TIMEOUT,
  );

  it(
    "a square in backdrop mode is 1080 × 1080",
    async () => {
      const jpeg = await card("square", { bytes: samplePhoto("gallery-opening.jpg"), focus: null });
      expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1080 });
      expect(jpeg.length).toBeLessThan(1.5 * 1024 * 1024);
    },
    RENDER_TIMEOUT,
  );

  it(
    "backdrop mode puts the sharp photo's bottom edge 80 px below the text block's top, over the darker blurred copy",
    async () => {
      // A white 600 × 300 photo: enlarged 6.4 times to cover a story, so backdrop mode. Its sharp copy is
      // 1080 × 540. With a one-line title the block's top is y 1212, so the copy runs from y 752 to 1292,
      // fully opaque from 14% (y 828) to 78% (y 1173), and the fade only starts at y 912.
      const white = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
      const jpeg = await card("story", { bytes: new Uint8Array(white), focus: null });
      const sharpPart = await meanOf(jpeg, { left: 900, top: 860, width: 100, height: 30 });
      const backdropPart = await meanOf(jpeg, { left: 900, top: 680, width: 100, height: 40 });
      expect(sharpPart.r).toBeGreaterThan(240);
      // The backdrop is the same white at 0.7.
      expect(backdropPart.r).toBeGreaterThan(165);
      expect(backdropPart.r).toBeLessThan(192);
    },
    RENDER_TIMEOUT,
  );

  it(
    "an unreadable photo gives the no-photo card: Signal Orange",
    async () => {
      const jpeg = await card("story", { bytes: new TextEncoder().encode("not an image"), focus: null });
      const corner = await meanOf(jpeg, { left: 0, top: 0, width: 60, height: 200 });
      expect(corner.r).toBeGreaterThan(245);
      expect(Math.abs(corner.g - 0x48)).toBeLessThan(10);
      expect(corner.b).toBeLessThan(10);
    },
    RENDER_TIMEOUT,
  );

  it(
    "a long title wraps, steps down and is clamped: nothing above where the block may rise (story y 859, square y 510)",
    async () => {
      const long = "The Extremely Long and Winding Annual Northside Celebration of Independent Zines and Prints";
      for (const [format, from, to] of [
        ["story", 360, 850],
        ["square", 130, 500],
      ] as const) {
        const jpeg = await card(format, null, long);
        // Black type on orange: no dark pixel between the top row and the clamped title.
        const pixels = await pixelsOf(jpeg, { left: 60, top: from, width: 960, height: to - from });
        expect(pixels.every(([r, , b]) => r > 200 && b < 60)).toBe(true);
        // …and the title is there below it.
        const block = await pixelsOf(jpeg, { left: 60, top: to, width: 960, height: (format === "story" ? 1600 : 1020) - to });
        expect(block.some(([r]) => r < 60)).toBe(true);
      }
    },
    RENDER_TIMEOUT,
  );

  it(
    "a single word longer than a line breaks instead of running off the card",
    async () => {
      const jpeg = await card("story", null, "Supercalifragilisticexpialidociousnessly");
      // The right margin (x 1000–1080) stays orange down the whole block.
      const margin = await pixelsOf(jpeg, { left: 1004, top: 860, width: 76, height: 740 });
      expect(margin.every(([r, , b]) => r > 200 && b < 60)).toBe(true);
    },
    RENDER_TIMEOUT,
  );
});

describe("inStoryCardSlot", () => {
  it("runs 2 at once, queues 6, refuses the 9th with a 503, and hands slots on", async () => {
    const { running, waiting } = STORY_CARD_RENDER_SLOTS;
    const releases: (() => void)[] = [];
    const started: number[] = [];
    const jobs = Array.from({ length: running + waiting }, (_, i) =>
      inStoryCardSlot(
        () =>
          new Promise<number>((resolve) => {
            started.push(i);
            releases.push(() => resolve(i));
          }),
      ),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    await expect(inStoryCardSlot(async () => 0)).rejects.toMatchObject({ statusCode: 503 });
    await expect(inStoryCardSlot(async () => 0)).rejects.toBeInstanceOf(HttpError);
    // Finish them one by one: each hands its slot to the next in line.
    for (let done = 0; done < jobs.length; done++) {
      releases[done]();
      await jobs[done];
    }
    expect(started).toEqual(jobs.map((_, i) => i));
    // All slots free again.
    await expect(inStoryCardSlot(async () => "ok")).resolves.toBe("ok");
  });

  it("frees the slot when the work throws", async () => {
    for (let i = 0; i < STORY_CARD_RENDER_SLOTS.running + STORY_CARD_RENDER_SLOTS.waiting + 2; i++) {
      await expect(inStoryCardSlot(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    }
    await expect(inStoryCardSlot(async () => "ok")).resolves.toBe("ok");
  });
});
