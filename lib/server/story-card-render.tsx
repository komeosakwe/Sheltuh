import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import sharp from "sharp";
import { WORDMARK } from "@/components/brand/marks";
import {
  rgbCss,
  STORY_CARD_SIZES,
  STORY_CARD_TITLE_LINES,
  storyCardTitleSize,
  type StoryCardFormat,
  type StoryCardTag,
  type StoryCardText,
} from "@/lib/story-card";
import { HttpError } from "./http";
import type { PhotoFocus } from "./share-card-data";
import { Mark } from "./share-card-render";
import { storyCardPhoto, type StoryCardPhoto } from "./story-card-photo";

/**
 * The "I’m going." story card (docs/design/story-card.md): 1080 × 1920 for a story, 1080 × 1080
 * for a post. Satori (next/og) lays out the layers that lib/server/story-card-photo.ts prepared
 * and sets the type; the PNG it returns is re-encoded as a JPEG with sharp.
 *
 * The layers, in paint order (design §4.4): the photo (or its blurred backdrop); a column whose
 * upper zone holds the sharp photo (backdrop mode) and whose lower zone holds the fade and the
 * text, bottom-anchored, so a longer title pushes the text and the fade upwards without anything
 * being measured; the top shade; the tag; the wordmark. With no photo: Signal Orange and black
 * type (design §6).
 *
 * Satori limits met here (PR 1's spike): a text run can't mix weights inline, so a line with two
 * weights is a flex row of two elements; `backdrop-filter` doesn't exist (the tag has no blur);
 * CSS `filter: blur()` renders but costs seconds, so the blur is done in sharp.
 *
 * Type: Instrument Sans, static TTFs (400, 500, 600, 700) from the family's own release
 * (github.com/Instrument/instrument-sans, fonts/ttf at 7fa2230, the commit Google Fonts ships), in
 * app/fonts/og/ under the SIL OFL 1.1 beside them. A character the font lacks makes next/og fetch
 * a fallback face from Google Fonts at render time (and an emoji from a CDN): the card's text has
 * its emoji removed first (lib/story-card.ts stripEmoji), and only public event text is ever sent.
 */

const ORANGE = "#ff4800";
const BLACK = "#000000";
const WHITE = "#ffffff";
const SANS = "Instrument Sans";

/** The design's values (docs/design/story-card.md §4.1). */
interface Layout {
  margin: number;
  tagTop: number;
  markTop: number;
  markWidth: number;
  blockBottom: number;
  goingSize: number;
  goingLine: number;
  goingDot: number;
  titleGap: number;
  factsGap: number;
  factsSize: number;
  factsLine: number;
  footGap: number;
  footPad: number;
  footSize: number;
  footLine: number;
  topShade: number;
  /** The fade's stops, in px from its top edge (300 above the text block): 0.72 here, then solid. */
  fadeMid: number;
  fadeEnd: number;
}

const LAYOUT: Readonly<Record<StoryCardFormat, Layout>> = {
  story: {
    margin: 80,
    tagTop: 282,
    markTop: 296,
    markWidth: 150,
    blockBottom: 320,
    goingSize: 46,
    goingLine: 53,
    goingDot: 15,
    titleGap: 14,
    factsGap: 26,
    factsSize: 33,
    factsLine: 48,
    footGap: 30,
    footPad: 22,
    footSize: 23,
    footLine: 28,
    topShade: 560,
    fadeMid: 388,
    fadeEnd: 797,
  },
  square: {
    margin: 60,
    tagTop: 60,
    markTop: 74,
    markWidth: 140,
    blockBottom: 60,
    goingSize: 40,
    goingLine: 46,
    goingDot: 13,
    titleGap: 10,
    factsGap: 18,
    factsSize: 30,
    factsLine: 44,
    footGap: 18,
    footPad: 16,
    footSize: 21,
    footLine: 26,
    topShade: 260,
    fadeMid: 258,
    fadeEnd: 529,
  },
};

/** How far above the text block the fade starts. */
const FADE_ABOVE = 300;
/** The upper zone ends this far below the top of the text block: where the sharp photo's bottom edge sits. */
const SHARP_BELOW_BLOCK = 80;
const SHARP_MASK = "linear-gradient(180deg, transparent 0%, #000 14%, #000 78%, transparent 100%)";

/** Room above the title's first line for accents on capitals, in em (design §4.2, spike S4). */
const TITLE_ACCENT_ROOM = 0.12;

/** Tag: 600 28/32, padding 12/20, 1.5 px border: 59 px tall. */
const TAG = { size: 28, line: 32, padY: 12, padX: 20, radius: 12, border: 1.5, dot: 12 } as const;

type CardFont = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" };
let fonts: CardFont[] | null = null;

/** The four weights, read once per server instance (process.cwd() is the app root). */
function cardFonts(): CardFont[] {
  if (!fonts) {
    const dir = path.join(process.cwd(), "app", "fonts", "og");
    const face = (file: string, weight: CardFont["weight"]): CardFont => ({
      name: SANS,
      data: readFileSync(path.join(dir, file)),
      weight,
      style: "normal",
    });
    fonts = [
      face("InstrumentSans-Regular.ttf", 400),
      face("InstrumentSans-Medium.ttf", 500),
      face("InstrumentSans-SemiBold.ttf", 600),
      face("InstrumentSans-Bold.ttf", 700),
    ];
  }
  return fonts;
}

/** The colours a card is drawn in: from the photo's tone, or the no-photo card's ink on orange. */
interface Palette {
  background: string;
  ink: string;
  /** Time and place. */
  quiet: string;
  dots: string;
  footerRule: string;
  footerOpacity: number;
  footerQuiet: string;
  footerSite: string;
  tagFill: string;
  tagBorder: string;
  tagDots: string;
  fade: ((layout: Layout) => string) | null;
}

function photoPalette(photo: StoryCardPhoto): Palette {
  const { tone, light } = photo.tone;
  return {
    background: rgbCss(tone),
    ink: WHITE,
    quiet: rgbCss(light),
    dots: ORANGE,
    footerRule: "rgba(255, 255, 255, 0.16)",
    footerOpacity: 0.85,
    footerQuiet: rgbCss(light),
    footerSite: "rgba(255, 255, 255, 0.9)",
    tagFill: "rgba(0, 0, 0, 0.38)",
    tagBorder: "rgba(255, 255, 255, 0.22)",
    tagDots: ORANGE,
    fade: (layout) =>
      `linear-gradient(180deg, ${rgbCss(tone, 0)} 0px, ${rgbCss(tone, 0.72)} ${layout.fadeMid}px, ${rgbCss(tone)} ${layout.fadeEnd}px)`,
  };
}

/** No photo (design §6): flat Signal Orange, black type and dots, an ink tag. No grey and no opacity on orange. */
const NO_PHOTO_PALETTE: Palette = {
  background: ORANGE,
  ink: BLACK,
  quiet: BLACK,
  dots: BLACK,
  footerRule: "rgba(0, 0, 0, 0.24)",
  footerOpacity: 1,
  footerQuiet: BLACK,
  footerSite: BLACK,
  tagFill: BLACK,
  // The same colour as the fill: the pill keeps its 59 px.
  tagBorder: BLACK,
  tagDots: ORANGE,
  fade: null,
};

function Dots({ size, color }: { size: number; color: string }) {
  const dot: CSSProperties = { width: size, height: size, borderRadius: 3, background: color };
  return (
    <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
      <div style={dot} />
      <div style={dot} />
    </div>
  );
}

export interface StoryCardContent {
  format: StoryCardFormat;
  text: StoryCardText;
  tag: StoryCardTag;
  /** The prepared photo (lib/server/story-card-photo.ts), or null: the no-photo card. */
  photo: StoryCardPhoto | null;
}

/** The card's drawing, for Satori. */
export function StoryCardView({ format, text, tag, photo }: StoryCardContent) {
  const { width, height } = STORY_CARD_SIZES[format];
  const layout = LAYOUT[format];
  const palette = photo ? photoPalette(photo) : NO_PHOTO_PALETTE;
  const titleSize = storyCardTitleSize(text.title, format);
  const fade = palette.fade?.(layout);

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: palette.background,
        fontFamily: SANS,
        color: palette.ink,
      }}
    >
      {/* 1: the photo, or its blurred backdrop drawn at full size. */}
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori, not the browser: next/image doesn't apply
        <img src={photo.background} width={width} height={height} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
      ) : null}

      {/* 2: the column. A (upper zone) ends 80 px below the text block's top; B (lower zone) is the block. */}
      <div style={{ position: "absolute", top: 0, left: 0, width, height, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            marginBottom: -SHARP_BELOW_BLOCK,
          }}
        >
          {photo?.sharp ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori, not the browser: next/image doesn't apply
            <img
              src={photo.sharp.src}
              width={photo.sharp.width}
              height={photo.sharp.height}
              alt=""
              // marginTop auto: at the zone's bottom when it fits; from the top (and on under the text) when it doesn't.
              style={{ flexShrink: 0, marginTop: "auto", maskImage: SHARP_MASK }}
            />
          ) : null}
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            paddingLeft: layout.margin,
            paddingRight: layout.margin,
            paddingBottom: layout.blockBottom,
          }}
        >
          {fade ? <div style={{ position: "absolute", top: -FADE_ABOVE, left: 0, right: 0, bottom: 0, backgroundImage: fade }} /> : null}

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Dots size={layout.goingDot} color={palette.dots} />
            <div
              style={{
                display: "block",
                fontWeight: 600,
                fontSize: layout.goingSize,
                lineHeight: layout.goingLine / layout.goingSize,
                letterSpacing: "-0.01em",
              }}
            >
              I’m going.
            </div>
          </div>

          <div
            style={{
              display: "block",
              // The clamp needs overflow hidden, which would cut the accents off a first line of
              // capitals (É, Ü) at line height 0.92: the box grows upwards without moving the type.
              marginTop: layout.titleGap - TITLE_ACCENT_ROOM * titleSize,
              paddingTop: TITLE_ACCENT_ROOM * titleSize,
              fontWeight: 700,
              fontSize: titleSize,
              lineHeight: 0.92,
              letterSpacing: "-0.04em",
              textTransform: "uppercase",
              wordBreak: "break-word",
              lineClamp: STORY_CARD_TITLE_LINES[format],
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {text.title}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: layout.factsGap,
              fontSize: layout.factsSize,
              lineHeight: layout.factsLine / layout.factsSize,
            }}
          >
            {/* Two weights on one line: two elements in a row (Satori has no inline runs). */}
            <div style={{ display: "flex" }}>
              <div style={{ display: "block", fontWeight: 600, color: palette.ink, flexShrink: 0 }}>{text.date}</div>
              <div style={{ display: "block", fontWeight: 400, color: palette.quiet }}>{` · ${text.time}`}</div>
            </div>
            {text.place ? (
              <div
                style={{
                  display: "block",
                  fontWeight: 400,
                  color: palette.quiet,
                  lineClamp: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {text.place}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: layout.footGap,
              paddingTop: layout.footPad,
              borderTop: `1px solid ${palette.footerRule}`,
              opacity: palette.footerOpacity,
              fontSize: layout.footSize,
              lineHeight: layout.footLine / layout.footSize,
            }}
          >
            <div style={{ display: "block", fontWeight: 500, color: palette.footerQuiet }}>Discover on</div>
            <div style={{ display: "block", fontWeight: 600, color: palette.footerSite }}>sheltuh.com.au</div>
          </div>
        </div>
      </div>

      {/* 3: the top shade, under the tag and the wordmark (an ink scrim). */}
      {photo ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: layout.topShade,
            backgroundImage: "linear-gradient(180deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 100%)",
          }}
        />
      ) : null}

      {/* 4: the tag. */}
      <div
        style={{
          position: "absolute",
          left: layout.margin,
          top: layout.tagTop,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: `${TAG.padY}px ${TAG.padX}px`,
          borderRadius: TAG.radius,
          background: palette.tagFill,
          border: `${TAG.border}px solid ${palette.tagBorder}`,
        }}
      >
        <Dots size={TAG.dot} color={palette.tagDots} />
        <div style={{ display: "block", fontWeight: 600, fontSize: TAG.size, lineHeight: TAG.line / TAG.size, color: WHITE }}>{tag}</div>
      </div>

      {/* 5: the wordmark. */}
      <div style={{ position: "absolute", right: layout.margin, top: layout.markTop, display: "flex" }}>
        <Mark mark={WORDMARK} width={layout.markWidth} color={photo ? WHITE : BLACK} />
      </div>
    </div>
  );
}

/** The card's JPEG: 4:4:4 keeps the orange dots and the small type clean. (mozjpeg saved ~5% for 5× the time: not used.) */
const CARD_JPEG = { quality: 86, chromaSubsampling: "4:4:4" } as const;

/** Draws a card and returns its JPEG bytes. Throws if the drawing fails. */
export async function renderStoryCard(content: StoryCardContent): Promise<Buffer> {
  const response = new ImageResponse(<StoryCardView {...content} />, { ...STORY_CARD_SIZES[content.format], fonts: cardFonts() });
  const png = Buffer.from(await response.arrayBuffer());
  return sharp(png).jpeg(CARD_JPEG).toBuffer();
}

/** Cards made at once on one server instance, and how many more may wait; beyond that, 503. */
export const STORY_CARD_RENDER_SLOTS = { running: 2, waiting: 6 } as const;

let running = 0;
const waiting: (() => void)[] = [];

/**
 * Runs `work` in one of the instance's render slots (a card is a couple of seconds of CPU and
 * tens of MB of memory): 2 at once, 6 waiting, then a 503. As lib/server/avatar.ts inEncodeSlot,
 * with its own slots and message.
 */
export async function inStoryCardSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < STORY_CARD_RENDER_SLOTS.running) {
    running += 1;
  } else {
    if (waiting.length >= STORY_CARD_RENDER_SLOTS.waiting) {
      throw new HttpError(503, "Lots of cards are being made right now. Try again in a minute.");
    }
    // The slot is handed over by the finishing job (running stays the same).
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export interface StoryCardRequest {
  format: StoryCardFormat;
  text: StoryCardText;
  tag: StoryCardTag;
  /** The cover photo's bytes and focus, or null for none. */
  photo: { bytes: Uint8Array; focus: PhotoFocus } | null;
}

/**
 * A card's JPEG, made in a render slot: the photo prepared (or, if it can't be used, the no-photo
 * card), then drawn. Throws an HttpError 503 when the slots are full, or the drawing's error.
 */
export async function makeStoryCard({ format, text, tag, photo }: StoryCardRequest): Promise<Buffer> {
  return inStoryCardSlot(async () => {
    const prepared = photo ? await storyCardPhoto(photo.bytes, photo.focus, format) : null;
    return renderStoryCard({ format, text, tag, photo: prepared });
  });
}
