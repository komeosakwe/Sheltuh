/**
 * Renders the story card's reference set (docs/design/story-card.md §0: the design round's r4 and
 * r5 cards) and the cases the round didn't draw (no photo, an 80-character title, a single long
 * word, accented capitals, emoji, a Perth event, each tag) to local JPEGs, for visual QA beside
 * the references. Fictional event text and the cleared sample photos in public/events/ only.
 * Touches no database or service.
 *
 *   node --import tsx scripts/preview-story-cards.ts [--out=dir] [--only=name,name]
 *
 * Output: story-card-previews/*.jpg (git-ignored), or `--out`'s directory, and a line per card
 * with its render time and size, then p50 / p95 over the set.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storyCardTag, storyCardText, type StoryCardEventFields, type StoryCardFormat } from "../lib/story-card";
import { makeStoryCard } from "../lib/server/story-card-render";

const args = process.argv.slice(2);
const outDir = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "story-card-previews";
const only = args
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",");

/** The design round's sample event: Sat 14 Nov 2026, 5–9 pm, Melbourne. */
const HERE_AND_NOW: StoryCardEventFields = {
  title: "Here & Now",
  startsAt: "2026-11-14T06:00:00.000Z",
  endsAt: "2026-11-14T10:00:00.000Z",
  timeZone: "Australia/Melbourne",
  state: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
};
const LONG = "The Long Night of Short Films";
const SHORT = "Zine";

/** Wed 11 Nov, noon in Melbourne: "In 3 days". */
const THREE_DAYS_BEFORE = new Date("2026-11-11T01:00:00.000Z");
/** Sat 14 Nov, 10 am in Melbourne: "Tonight". */
const SAME_MORNING = new Date("2026-11-13T23:00:00.000Z");

interface Preview {
  name: string;
  format: StoryCardFormat;
  photo: { file: string; focus: { x: number; y: number } | null } | null;
  event?: Partial<StoryCardEventFields>;
  now?: Date;
}

const market = { file: "street-market.jpg", focus: { x: 50, y: 30 } };
const crate = { file: "dj-crate-digging.jpg", focus: { x: 85, y: 50 } };
const gallery = { file: "gallery-opening.jpg", focus: null };
const vintage = { file: "vintage-market-stall.jpg", focus: null };
const djdeck = { file: "record-shop-dj.jpg", focus: { x: 45, y: 50 } };
const trumpet = { file: "jazz-drummer.webp", focus: null };

const PREVIEWS: Preview[] = [
  // Round 4.
  { name: "r4-01-fullbleed-market", format: "story", photo: market },
  { name: "r4-01-fullbleed-crate", format: "story", photo: crate },
  { name: "r4-02-fullbleed-square-market", format: "square", photo: market },
  { name: "r4-02-fullbleed-square-crate", format: "square", photo: crate },
  { name: "r4-03-fullbleed-tonight-crate", format: "story", photo: crate, now: SAME_MORNING },
  // Round 5.
  { name: "r5-01-gallery", format: "story", photo: gallery },
  { name: "r5-02-vintage", format: "story", photo: vintage },
  { name: "r5-03-djdeck-long", format: "story", photo: djdeck, event: { title: LONG } },
  { name: "r5-04-trumpet-short", format: "story", photo: trumpet, event: { title: SHORT } },
  { name: "r5-05-gallery-long", format: "story", photo: gallery, event: { title: LONG } },
  { name: "r5-06-market-short", format: "story", photo: market, event: { title: SHORT } },
  // Not drawn in the design round.
  { name: "x-no-photo", format: "story", photo: null },
  { name: "x-no-photo-square", format: "square", photo: null },
  {
    name: "x-title-80",
    format: "story",
    photo: crate,
    event: { title: "The Extremely Long and Winding Annual Northside Celebration of Independent Zines and Prints" },
  },
  {
    name: "x-title-80-square",
    format: "square",
    photo: gallery,
    event: { title: "The Extremely Long and Winding Annual Northside Celebration of Independent Zines and Prints" },
  },
  { name: "x-long-word", format: "story", photo: vintage, event: { title: "Supercalifragilisticexpialidociousnessly" } },
  { name: "x-accents", format: "story", photo: market, event: { title: "Été à München" } },
  { name: "x-emoji", format: "story", photo: trumpet, event: { title: "🎷 Late Jazz 🌙✨ at the Corner" } },
  {
    name: "x-perth",
    format: "story",
    photo: djdeck,
    event: {
      title: "Fremantle Records Night",
      startsAt: "2026-11-21T12:00:00.000Z",
      endsAt: "2026-11-21T16:00:00.000Z",
      timeZone: "Australia/Perth",
      state: "WA",
      venueName: "Mojos Bar",
      suburb: "North Fremantle",
    },
  },
  { name: "x-today", format: "story", photo: market, event: { startsAt: "2026-11-14T03:00:00.000Z" }, now: SAME_MORNING },
  { name: "x-on-now-square", format: "square", photo: vintage, now: new Date("2026-11-14T07:00:00.000Z") },
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const times: number[] = [];
  for (const preview of PREVIEWS) {
    if (only && !only.includes(preview.name)) continue;
    const event = { ...HERE_AND_NOW, ...preview.event };
    const tag = storyCardTag(event, preview.now ?? THREE_DAYS_BEFORE);
    if (!tag) throw new Error(`${preview.name}: no tag (the event has ended at that time)`);
    const photo = preview.photo
      ? { bytes: readFileSync(path.join(process.cwd(), "public", "events", preview.photo.file)), focus: preview.photo.focus }
      : null;
    const started = performance.now();
    const jpeg = await makeStoryCard({ format: preview.format, text: storyCardText(event), tag, photo });
    const ms = performance.now() - started;
    times.push(ms);
    writeFileSync(path.join(outDir, `${preview.name}.jpg`), jpeg);
    console.log(`${preview.name.padEnd(32)} ${tag.padEnd(10)} ${ms.toFixed(0).padStart(5)} ms ${(jpeg.length / 1024).toFixed(0).padStart(5)} KB`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  if (sorted.length) console.log(`${sorted.length} cards: p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms (the first includes loading the fonts and next/og)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
