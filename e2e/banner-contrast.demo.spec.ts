import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { sampleEvents } from "@/lib/sample-events";

/**
 * The featured banner's words against its photos (WCAG 1.4.3), on the demo build ("demo" project:
 * the file name ends demo.spec.ts), with every demo slide at every width from 320 to 1440px.
 *
 * The words sit on a scrim (FeaturedCarousel [data-slide-scrim], globals.css banner-scrim): clear at
 * its top and 60% ink 6rem down, where the words start. So:
 * (a) geometry: the category's top (the first line) is at least 6rem below the scrim's top;
 * (b) pixels: with the words, the ticket action and the controls hidden (the scrim and the photo
 *     stay), each slide is screenshotted and the brightest pixel behind each line of text is found.
 *     The words are white, so each line's contrast is against that pixel: at least 4.5:1 for the
 *     category and the facts, 3:1 for the title (large text).
 * Both again with a long title forced onto two lines (the title's clamp), so the words start higher.
 * The worst value per width is printed, and attached to the report.
 */

/** An hour before the first sample event starts: every sample is upcoming (as e2e/demo.spec.ts). */
const SAMPLES_UPCOMING_AT = Math.min(...sampleEvents.map((e) => Date.parse(e.startsAt))) - 3600_000;

const WIDTHS = [320, 390, 640, 768, 1024, 1200, 1280, 1440] as const;
const FADE_PX = 96; // 6rem at the default 16px root size
const LONG_TITLE = "A much longer event title that has to wrap onto a second line";

type Kind = "category" | "title" | "facts";
const MIN: Record<Kind, number> = { category: 4.5, title: 3, facts: 4.5 };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Measured {
  /** The category's top less the scrim's top, in CSS px. */
  fadeAbove: number;
  /** How many lines the title takes. */
  titleLines: number;
  /** Each line's box, relative to the slide's top-left. */
  lines: { kind: Kind; rect: Rect }[];
}

/** sRGB channel (0–255) to linear light. */
const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** White text on a pixel of luminance `l`. */
const whiteOn = (l: number) => 1.05 / (l + 0.05);

/** Moves to slide `index` (its dot) and waits until it's in place, its photo loaded. */
async function showSlide(page: Page, index: number) {
  const slides = page.locator("[data-featured-carousel] [data-slide]");
  const dots = page.locator("[data-carousel-controls] [aria-label^='Slide ']");
  if ((await dots.count()) > 0) await dots.nth(index).click();
  await expect(slides.nth(index)).toHaveAttribute("data-current", "");
  const slide = slides.nth(index);
  // Snapped into the track's box (no glide left).
  await expect
    .poll(async () => {
      const [s, t] = await Promise.all([slide.boundingBox(), page.locator("#home-featured-slides").boundingBox()]);
      return s && t ? Math.abs(s.x - t.x) : Infinity;
    })
    .toBeLessThanOrEqual(1);
  // Its photo loaded, when its sample has one (bounded: a broken photo, which EventArt swaps for the poster art, is
  // reported as broken rather than waited on to the timeout); a sample with no photo shows its poster art.
  const title = ((await slide.locator("[data-banner-link]").textContent()) ?? "").trim();
  const sample = sampleEvents.find((event) => event.title === title);
  if (sample?.imageUrl) {
    await expect
      .poll(() => slide.evaluate((el) => Array.from(el.querySelectorAll("img")).some((img) => img.complete && img.naturalWidth > 0)), {
        message: `${title}: its photo loads (not broken, not swapped for the poster art)`,
      })
      .toBe(true);
  }
  return slide;
}

/** The lines of the slide's words, relative to the slide, and the scrim's geometry. */
function measure(slide: Locator): Promise<Measured> {
  return slide.evaluate((el): Measured => {
    const origin = el.getBoundingClientRect();
    const scrim = el.querySelector("[data-slide-scrim]");
    const category = el.querySelector("[data-slide-content] > p");
    const title = el.querySelector("[data-banner-link]");
    const facts = el.querySelector("[data-slide-facts]");
    if (!scrim || !category || !title || !facts) throw new Error("the slide's scrim or words are missing");
    /** Each line box of `node`'s text, cut to `clip` (the title's two-line clamp hides the rest). */
    const linesOf = (node: Element, clip: DOMRect) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects())
        .map((r) => {
          const left = Math.max(r.left, clip.left);
          const top = Math.max(r.top, clip.top);
          const right = Math.min(r.right, clip.right);
          const bottom = Math.min(r.bottom, clip.bottom);
          return { x: left - origin.left, y: top - origin.top, width: right - left, height: bottom - top };
        })
        .filter((r) => r.width > 1 && r.height > 1);
    };
    const titleBox = title.getBoundingClientRect();
    const titleLines = linesOf(title, titleBox);
    const rows = new Set(titleLines.map((r) => Math.round(r.y)));
    return {
      fadeAbove: category.getBoundingClientRect().top - scrim.getBoundingClientRect().top,
      titleLines: rows.size,
      lines: [
        ...linesOf(category, category.getBoundingClientRect()).map((rect) => ({ kind: "category" as const, rect })),
        ...titleLines.map((rect) => ({ kind: "title" as const, rect })),
        ...linesOf(facts, facts.getBoundingClientRect()).map((rect) => ({ kind: "facts" as const, rect })),
      ],
    };
  });
}

/** The slide's pixels with the words, the ticket action and the controls hidden; restored after. */
async function backdrop(page: Page, slide: Locator) {
  const hide = `[data-slide-content], [data-carousel-controls] { visibility: hidden !important; }`;
  const style = await page.addStyleTag({ content: hide });
  try {
    const png = await slide.screenshot({ animations: "disabled", scale: "css" });
    return await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } finally {
    await style.evaluate((el) => el.parentNode?.removeChild(el));
  }
}

/** The lowest contrast (white on the brightest pixel) inside `rect`. */
function worstIn(image: { data: Buffer; info: { width: number; height: number; channels: number } }, rect: Rect): number {
  const { data, info } = image;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(info.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(info.height, Math.ceil(rect.y + rect.height));
  let brightest = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * info.width + x) * info.channels;
      brightest = Math.max(brightest, luminance(data[i], data[i + 1], data[i + 2]));
    }
  }
  return whiteOn(brightest);
}

for (const width of WIDTHS) {
  test.describe(`the banner's words at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, reducedMotion: "reduce" });

    for (const long of [false, true]) {
      test(`every line is legible on every demo slide${long ? ", with a two-line title" : ""}`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        await page.clock.install({ time: SAMPLES_UPCOMING_AT });
        await page.goto("/");
        const slides = page.locator("[data-featured-carousel] [data-slide]");
        await expect(slides.first()).toBeVisible({ timeout: 60_000 });
        const count = await slides.count();
        expect(count).toBeGreaterThanOrEqual(1);

        const worst: Record<Kind, { ratio: number; slide: string }> = {
          category: { ratio: Infinity, slide: "" },
          title: { ratio: Infinity, slide: "" },
          facts: { ratio: Infinity, slide: "" },
        };
        let leastFade = Infinity;
        for (let i = 0; i < count; i++) {
          const slide = await showSlide(page, i);
          const name = (await slide.locator("[data-banner-link]").textContent()) ?? `slide ${i + 1}`;
          if (long) {
            await slide.locator("[data-banner-link]").evaluate((el, text) => {
              el.textContent = text;
            }, LONG_TITLE);
          }
          await slide.scrollIntoViewIfNeeded();
          // The banner's fonts in, so the lines measured are the lines screenshotted.
          await page.evaluate(() => document.fonts.ready);
          const measured = await measure(slide);
          // Every kind of words has a line to measure (an emptied facts row mustn't pass as Infinity:1).
          for (const kind of Object.keys(MIN) as Kind[]) {
            expect(measured.lines.filter((line) => line.kind === kind).length, `${name}: ${kind} has a line`).toBeGreaterThan(0);
          }
          if (long) expect(measured.titleLines, `${name}: the forced title wraps`).toBe(2);
          // (a) The words start where the scrim has reached 60% ink.
          leastFade = Math.min(leastFade, measured.fadeAbove);
          expect(measured.fadeAbove, `${name}: the category is 6rem below the scrim's top`).toBeGreaterThanOrEqual(FADE_PX - 0.5);

          // (b) Each line against the brightest pixel behind it.
          const image = await backdrop(page, slide);
          for (const { kind, rect } of measured.lines) {
            const ratio = worstIn(image, rect);
            if (ratio < worst[kind].ratio) worst[kind] = { ratio, slide: name };
            expect(ratio, `${name}: ${kind} line at ${Math.round(rect.y)}px`).toBeGreaterThanOrEqual(MIN[kind]);
          }
        }

        const summary =
          `${width}px${long ? " (two-line title)" : ""}: ` +
          (Object.keys(worst) as Kind[]).map((kind) => `${kind} ${worst[kind].ratio.toFixed(2)}:1 (${worst[kind].slide})`).join(", ") +
          `; least fade above the words ${leastFade.toFixed(1)}px`;
        console.log(summary);
        testInfo.annotations.push({ type: "worst contrast", description: summary });
      });
    }
  });
}
