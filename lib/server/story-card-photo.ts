import sharp, { type OutputInfo } from "sharp";
import { backdropMode, FALLBACK_TONE, STORY_CARD_SIZES, toneFromMean, type StoryCardFormat, type StoryCardTone } from "@/lib/story-card";
import { loaderFormat } from "./avatar";
import { redactForLog } from "./email-address";
import { EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS, MAX_EVENT_IMAGE_INPUT_PIXELS } from "./event-image";
import { coverCrop, dataUrl, type CoverCrop, type PhotoFocus } from "./share-card-data";

/**
 * The story card's photo work (docs/design/story-card.md §3.2, §5), all done in sharp before
 * Satori lays anything out: Satori only draws the layers this returns.
 *
 *   - Full-bleed: the photo cropped to the card around its focus point (object-position's maths).
 *   - Backdrop mode (covering the card would enlarge it more than 1.6 times): a blurred, darkened
 *     copy of that crop at a quarter of the size, which Satori draws at full size, and the whole
 *     photo at the card's width, drawn sharp over it: only as much of it as the card can show
 *     (its top, at most the card's height), so a very tall photo costs no more than a short one.
 *   - Every crop is cut from the photo before it's scaled, so nothing larger than the card is
 *     ever made, whatever the photo's shape (anything up to the 24 MP cap is stored).
 *   - The tone: the mean colour of the bottom third of the crop (48 × 48, rows 32–47), on sRGB
 *     values, through toneFromMean.
 *
 * Null when the photo can't be used (not a JPEG, PNG or WebP, over the pixel cap, corrupt, too
 * slow): the card is then drawn without a photo. Never throws.
 */

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
  /**
   * Backdrop mode only: the photo at the card's width, uncropped, as tall as `fullHeight` but cut
   * to its top `height` rows (at most the card's height: the rest could never show). The fade
   * mask is laid out over `fullHeight`, so a cut layer looks exactly like the whole one.
   */
  sharp: { src: string; width: number; height: number; fullHeight: number } | null;
  tone: StoryCardTone;
}

const jpegUrl = (bytes: Buffer) => dataUrl("image/jpeg", bytes);

/** The photo's decoder: the upload's pixel cap and encode timeout (lib/server/event-image.ts), first frame only. */
function decoder(bytes: Uint8Array) {
  return sharp(bytes, { limitInputPixels: MAX_EVENT_IMAGE_INPUT_PIXELS, failOn: "error", pages: 1 }).timeout({
    seconds: EVENT_IMAGE_ENCODE_TIMEOUT_SECONDS,
  });
}

/**
 * coverCrop's region in the photo's own pixels (w × h after rotation), so it can be cut before
 * scaling: scaling a whole tall photo up to cover the card first would make an image many times
 * the card's size only to throw most of it away.
 */
export function sourceRegion(w: number, h: number, crop: CoverCrop): { left: number; top: number; width: number; height: number } {
  const sx = crop.resize.width / w;
  const sy = crop.resize.height / h;
  const left = Math.min(w - 1, Math.max(0, Math.round(crop.extract.left / sx)));
  const top = Math.min(h - 1, Math.max(0, Math.round(crop.extract.top / sy)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(w - left, Math.round(crop.extract.width / sx))),
    height: Math.max(1, Math.min(h - top, Math.round(crop.extract.height / sy))),
  };
}

/**
 * The crop's tone: the mean of the bottom third of the crop at 48 × 48. The fallback tone if that
 * fails. The pixels are averaged here, not with sharp's stats(), which describes the pipeline's
 * input and ignores its resize and extract.
 */
export async function sampleTone(crop: { data: Buffer; info: OutputInfo }): Promise<StoryCardTone> {
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
    // One decode for the crop, as raw sRGB pixels with any alpha flattened onto black: the
    // region is cut first (in the photo's own pixels), then scaled to exactly the crop's size.
    const region = sourceRegion(w, h, coverCrop(w, h, cropSize, focus));
    const raw = await decoder(bytes)
      .rotate()
      .extract(region)
      .flatten({ background: "#000000" })
      .resize(cropSize.width, cropSize.height, { fit: "fill" })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rawInput = { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } } as const;
    const tone = await sampleTone(raw);

    if (!backdrop) {
      const jpeg = await sharp(raw.data, rawInput).jpeg({ quality: LAYER_QUALITY }).toBuffer();
      return { mode: "full-bleed", background: jpegUrl(jpeg), sharp: null, tone };
    }

    const blurred = await sharp(raw.data, rawInput)
      .blur(BACKDROP_BLUR_SIGMA)
      .linear(BACKDROP_BRIGHTNESS, 0)
      .jpeg({ quality: LAYER_QUALITY })
      .toBuffer();
    // The whole photo, uncropped (the focus doesn't apply), at the card's width. Only its top can
    // show: taller than the card's upper zone, it starts at the card's top (design §4.4).
    const fullHeight = Math.max(1, Math.round((card.width * h) / w));
    const shown = Math.min(fullHeight, card.height);
    const sourceRows = Math.max(1, Math.min(h, Math.round((shown * w) / card.width)));
    const layer = await decoder(bytes)
      .rotate()
      .extract({ left: 0, top: 0, width: w, height: sourceRows })
      .flatten({ background: "#000000" })
      .resize(card.width, shown, { fit: "fill" })
      .jpeg({ quality: LAYER_QUALITY })
      .toBuffer();
    return {
      mode: "backdrop",
      background: jpegUrl(blurred),
      sharp: { src: jpegUrl(layer), width: card.width, height: shown, fullHeight },
      tone,
    };
  } catch (err) {
    console.error("Story card photo unavailable:", redactForLog(err instanceof Error ? err.message : "unknown error"));
    return null;
  }
}
