import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { DOTS_MARK, WORDMARK, type BrandMark } from "@/components/brand/marks";
import { cardText, cardTitleSize, dottedText, SHARE_CARD_SIZE } from "@/lib/share-card";

/**
 * The link-preview cards (docs/design/brand-direction-one.md §4), 1200 × 630:
 *
 *   - the plain brand card: Signal Orange, the two-dot mark top-left and the
 *     uppercase wordmark bottom-left, both black, no text (the site's card,
 *     and what an unknown or unpublished page gets);
 *   - an event: its cover photo full bleed under a soft ink scrim, the title
 *     large in white, one line of date, time and place, and the wordmark
 *     small, white, top-left on the scrim (the brand allows the wordmark over
 *     a photo only on an ink scrim). With no photo: Signal Orange, the same
 *     type and wordmark in black;
 *   - an organiser: Signal Orange, their logo (or the two-dot mark) top-left,
 *     their name large in black and "on" with the wordmark small beneath.
 *
 * The marks are the official vectors from components/brand/marks.ts, drawn
 * whole, at their own ratio, in one colour. Type is in the brand faces:
 * Instrument Sans SemiBold for titles and names, with the brand's two dots
 * over every vowel (dottedText: what the site's Instrument Sans Dots does by
 * remapping its character map), and IBM Plex Mono Medium for the date line,
 * as the site sets dates. Satori can't read the site's WOFF2 files, so the
 * same OFL faces are vendored as WOFF in app/fonts/og/ (licences beside them).
 */

const { width: WIDTH, height: HEIGHT } = SHARE_CARD_SIZE;
const ORANGE = "#ff4800";
const BLACK = "#000000";
const WHITE = "#ffffff";
const MARGIN = 64;

/** Cache for a card that shows what's stored: its URL changes with the content, but a takedown should reach CDNs within about an hour. */
export const CARD_CACHE = "public, max-age=3600, s-maxage=3600";
/** Cache for the plain brand card served in place of one that can't be shown (not found, or a passing error). */
export const FALLBACK_CARD_CACHE = "public, max-age=300, s-maxage=300";

function Mark({ mark, width, color }: { mark: BrandMark; width: number; color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={mark.viewBox}
      width={width}
      height={Math.round(width / mark.ratio)}
      fill={color}
    >
      {mark.paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

const SANS = "Instrument Sans";
const MONO = "IBM Plex Mono";

type CardFont = { name: string; data: Buffer; weight: 500 | 600; style: "normal" };
let fonts: CardFont[] | null = null;

/** The two faces, read once per server instance (process.cwd() is the app root, so the files are traced into the deployment). */
function cardFonts(): CardFont[] {
  if (!fonts) {
    const dir = path.join(process.cwd(), "app", "fonts", "og");
    fonts = [
      { name: SANS, data: readFileSync(path.join(dir, "instrument-sans-latin-600-normal.woff")), weight: 600, style: "normal" },
      { name: MONO, data: readFileSync(path.join(dir, "ibm-plex-mono-latin-500-normal.woff")), weight: 500, style: "normal" },
    ];
  }
  return fonts;
}

function render(element: ReactElement, cache: string): ImageResponse {
  return new ImageResponse(element, { ...SHARE_CARD_SIZE, fonts: cardFonts(), headers: { "cache-control": cache } });
}

/** The site card: Signal Orange, the two-dot mark and the wordmark, black. */
export function brandCard(cache: string = FALLBACK_CARD_CACHE): ImageResponse {
  return render(<BrandCardView />, cache);
}

/** The site card's drawing, shared with app/opengraph-image.tsx. */
export function BrandCardView() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 96,
        background: ORANGE,
      }}
    >
      <Mark mark={DOTS_MARK} width={96} color={BLACK} />
      <Mark mark={WORDMARK} width={720} color={BLACK} />
    </div>
  );
}

/** The large text of a card: clamped to three lines, so a long title ends in an ellipsis. */
function Title({ text, size, color }: { text: string; size: number; color: string }) {
  return (
    <div
      style={{
        display: "block",
        fontFamily: SANS,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: -2,
        color,
        lineClamp: 3,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {dottedText(text)}
    </div>
  );
}

export interface EventCardContent {
  title: string;
  /** "Sat 6 Mar · 8:00 pm · Venue, Suburb" (lib/share-card.ts eventCardDetail). */
  detail: string;
  /** The cover photo as a 1200 × 630 data URL (lib/server/share-card-data.ts), or null: the orange card. */
  photo: string | null;
}

/** An event's card. */
export function eventCard({ title, detail, photo }: EventCardContent): ImageResponse {
  const text = cardText(title);
  const ink = photo ? WHITE : BLACK;
  const soft = photo ? "rgba(255, 255, 255, 0.86)" : "rgba(0, 0, 0, 0.78)";
  return render(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: photo ? BLACK : ORANGE }}>
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori, not the browser: next/image doesn't apply */}
          <img src={photo} width={WIDTH} height={HEIGHT} alt="" style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              backgroundImage:
                "linear-gradient(to bottom, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0) 26%, rgba(0, 0, 0, 0) 38%, rgba(0, 0, 0, 0.86) 100%)",
            }}
          />
        </>
      ) : null}
      <div style={{ position: "absolute", top: MARGIN - 8, left: MARGIN, display: "flex" }}>
        <Mark mark={WORDMARK} width={132} color={ink} />
      </div>
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          right: MARGIN,
          bottom: MARGIN - 8,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <Title text={text} size={cardTitleSize(text)} color={ink} />
        <div style={{ display: "block", fontFamily: MONO, fontWeight: 500, fontSize: 28, lineHeight: 1.2, color: soft, lineClamp: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
          {detail}
        </div>
      </div>
    </div>,
    CARD_CACHE,
  );
}

export interface OrganiserCardContent {
  displayName: string;
  /** The logo as a square PNG data URL (lib/server/share-card-data.ts), or null: the two-dot mark. */
  logo: string | null;
}

/** An organiser's card. */
export function organiserCard({ displayName, logo }: OrganiserCardContent): ImageResponse {
  const text = cardText(displayName);
  return render(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 96,
        background: ORANGE,
      }}
    >
      {logo ? (
        <div style={{ display: "flex", width: 160, height: 160, borderRadius: 32, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori, not the browser: next/image doesn't apply */}
          <img src={logo} width={160} height={160} alt="" style={{ objectFit: "cover" }} />
        </div>
      ) : (
        <Mark mark={DOTS_MARK} width={96} color={BLACK} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <Title text={text} size={cardTitleSize(text)} color={BLACK} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "block", fontFamily: SANS, fontWeight: 600, fontSize: 32, lineHeight: 1, color: "rgba(0, 0, 0, 0.78)" }}>
            {dottedText("on")}
          </div>
          <Mark mark={WORDMARK} width={132} color={BLACK} />
        </div>
      </div>
    </div>,
    CARD_CACHE,
  );
}
