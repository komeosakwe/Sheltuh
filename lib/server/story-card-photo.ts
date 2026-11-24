import sharp, { type OutputInfo } from "sharp";
import { backdropMode, FALLBACK_TONE, STORY_CARD_SIZES, toneFromMean, type StoryCardFormat, type StoryCardTone } from "@/lib/story-card";
import { loaderFormat } from "./avatar";
import { redactForLog } from "./email-address";
import { coverCrop, type PhotoFocus } from "./share-card-data";

/**
 * The story card's photo work (docs/design/story-card.md §3.2, §5), all done in sharp before
 * Satori lays anything out: Satori only draws the layers this returns.
 *
 *   - Full-bleed: the photo cropped to the card around its focus point (object-position's maths).
 *   - Backdrop mode (covering the card would enlarge it more than 1.6 times): a blurred, darkened
 *     copy of that crop at a quarter of the size, which Satori draws at full size, and the whole
 *     photo at the card's width, drawn sharp over it.
 *   - The tone: the mean colour of the bottom third of the crop (48 × 48, rows 32–47), on sRGB
 *     values, through toneFromMean.
 *
 * Null when the photo can't be used (not a JPEG, PNG or WebP, over the pixel cap, corrupt, too
 * slow): the card is then drawn without a photo. Never throws.
 */

/** Largest decoded image, in pixels (the same cap as uploads and the link preview). */
const MAX_INPUT_PIXELS = 24_000_000;

/** Each sharp pipeline gives up after this long (libvips' own timeout). */
const PIPELINE_TIMEOUT_SECONDS = 10;

/** The tone is sampled from the crop squashed to this square; its bottom third is rows 32–47. */
const SAMPLE_SIDE = 48;
const SAMPLE_TOP = 32;

/** The backdrop is made at this fraction of the card and drawn at full size. */
const BACKDROP_FRACTION = 4;
/** sigma 10 at ¼ size ≈ CSS blur(40px) at full size; × 0.7 ≈ brightness(.7). */
const BACKDROP_BLUR_SIGMA = 10;
const BACKDROP_BRIGHTNESS = 0.7;

/** JPEG quality of the layers handed to Satori (the link preview's). The card itself is encoded once more at the end. */
const LAYER_QUALITY = 82;

export interface StoryCardPhoto {
  mode: "full-bleed" | "backdrop";
  /** Full-bleed: the cover crop at the card's size. Backdrop: the blurred quarter-size copy. A JPEG data URL. */
  background: string;
  /** Backdrop mode only: the whole photo at the card's width, uncropped. */
  sharp: { src: string; width: number; height: number } | null;
  tone: StoryCardTone;
}

function dataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

function decoder(bytes: Uint8Array) {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", pages: 1 }).timeout({ seconds: PIPELINE_TIMEOUT_SECONDS });
}

/**
 * The crop's tone: the mean of the bottom third of the crop at 48 × 48. The fallback tone if that
 * fails. The pixels are averaged here, not with sharp's stats(), which describes the pipeline's
 * input and ignores its resize and extract.
 */
async function sampleTone(crop: { data: Buffer; info: OutputInfo }): Promise<StoryCardTone> {
  try {
    const { data, info } = await sharp(crop.data, { raw: { width: crop.info.width, height: crop.info.height, channels: crop.info.channels } })
      .resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: "fill" })
      .extract({ left: 0, top: SAMPLE_TOP, width: SAMPLE_SIDE, height: SAMPLE_SIDE - SAMPLE_TOP })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sums = [0, 0, 0];
    const pixels = info.width * info.height;
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < 3; c++) sums[c] += data[i * info.channels + c];
    }
    return toneFromMean(sums[0] / pixels, sums[1] / pixels, sums[2] / pixels);
  } catch {
    return FALLBACK_TONE;
  }
}

/** The photo prepared for a card in `format`, or null (see above). */
export async function storyCardPhoto(bytes: Uint8Array, focus: PhotoFocus, format: StoryCardFormat): Promise<StoryCardPhoto | null> {
  try {
    // The allowlist gates every pixel decode below (lib/server/avatar.ts loaderFormat).
    if (!(await loaderFormat(bytes))) return null;
    const { width = 0, height = 0, orientation = 1 } = await decoder(bytes).metadata();
    // EXIF orientations 5-8 are turned a quarter: rotate() swaps the sides.
    const [w, h] = orientation >= 5 ? [height, width] : [width, height];
    if (w < 1 || h < 1) return null;

    const card = STORY_CARD_SIZES[format];
    const backdrop = backdropMode(w, h, format);
    const cropSize = backdrop
      ? { width: Math.round(card.width / BACKDROP_FRACTION), height: Math.round(card.height / BACKDROP_FRACTION) }
      : card;
    const crop = coverCrop(w, h, cropSize, focus);
    // One decode for the crop, as raw sRGB pixels with any alpha flattened onto black.
    const raw = await decoder(bytes)
      .rotate()
      .flatten({ background: "#000000" })
      .resize(crop.resize.width, crop.resize.height, { fit: "fill" })
      .extract(crop.extract)
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawInput = { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } } as const;
    const tone = await sampleTone(raw);

    if (!backdrop) {
      const jpeg = await sharp(raw.data, rawInput).jpeg({ quality: LAYER_QUALITY }).toBuffer();
      return { mode: "full-bleed", background: dataUrl(jpeg), sharp: null, tone };
    }

    const blurred = await sharp(raw.data, rawInput)
      .blur(BACKDROP_BLUR_SIGMA)
      .linear(BACKDROP_BRIGHTNESS, 0)
      .jpeg({ quality: LAYER_QUALITY })
      .toBuffer();
    // The whole photo, uncropped (the focus doesn't apply), at the card's width.
    const sharpHeight = Math.max(1, Math.round((card.width * h) / w));
    const whole = await decoder(bytes)
      .rotate()
      .flatten({ background: "#000000" })
      .resize(card.width, sharpHeight, { fit: "fill" })
      .jpeg({ quality: LAYER_QUALITY })
      .toBuffer();
    return {
      mode: "backdrop",
      background: dataUrl(blurred),
      sharp: { src: dataUrl(whole), width: card.width, height: sharpHeight },
      tone,
    };
  } catch (err) {
    console.error("Story card photo unavailable:", redactForLog(err instanceof Error ? err.message : "unknown error"));
    return null;
  }
}
