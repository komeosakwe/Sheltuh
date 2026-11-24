import { describe, expect, it } from "vitest";
import {
  backdropMode,
  demoCardNow,
  FALLBACK_TONE,
  isStoryCardFormat,
  rgbCss,
  storyCardAvailable,
  storyCardFileName,
  storyCardFreshSeconds,
  storyCardPath,
  storyCardTag,
  storyCardText,
  storyCardTitleSize,
  storyCardVersion,
  stripEmoji,
  toneFromMean,
  type Rgb,
  type StoryCardEventFields,
  type StoryCardVersionInput,
} from "@/lib/story-card";
import type { SoonFields } from "@/lib/soon";

/**
 * The story card's pure rules (lib/story-card.ts, docs/design/story-card.md). Melbourne is AEDT
 * (UTC+11) in November, Perth AWST (UTC+8), Adelaide ACDT (UTC+10:30), Brisbane AEST (UTC+10).
 */
const at = (iso: string) => new Date(iso);
const melbourne = (startsAt: string, endsAt?: string): SoonFields => ({ startsAt, endsAt, timeZone: "Australia/Melbourne" });

/** Sat 14 Nov 2026, 5–9 pm Melbourne. */
const HERE_AND_NOW = melbourne("2026-11-14T06:00:00.000Z", "2026-11-14T10:00:00.000Z");

describe("storyCardTag", () => {
  it("In N days from 2 days out, then the soon tag's words", () => {
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-11T01:00:00.000Z"))).toBe("In 3 days"); // Wed noon
    expect(storyCardTag(HERE_AND_NOW, at("2026-10-01T01:00:00.000Z"))).toBe("In 44 days");
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-12T12:59:00.000Z"))).toBe("In 2 days"); // Thu 11:59 pm
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-12T13:00:00.000Z"))).toBe("Tomorrow"); // Fri 12:00 am
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-13T23:00:00.000Z"))).toBe("Tonight"); // Sat 10 am, a 5 pm start
    expect(storyCardTag(melbourne("2026-11-14T03:00:00.000Z"), at("2026-11-13T23:00:00.000Z"))).toBe("Today"); // a 2 pm start
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-14T07:00:00.000Z"))).toBe("On now"); // 6 pm
  });

  it("null once it has ended (no card), or for a time it can't read", () => {
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-14T10:00:00.000Z"))).toBeNull();
    expect(storyCardTag(HERE_AND_NOW, at("2026-11-20T00:00:00.000Z"))).toBeNull();
    expect(storyCardTag(melbourne("2026-11-14T06:00:00.000Z"), at("2026-11-14T06:00:00.000Z"))).toBeNull(); // no end: ends as it starts
    expect(storyCardTag(melbourne("not a date"), at("2026-11-11T01:00:00.000Z"))).toBeNull();
    expect(storyCardTag(HERE_AND_NOW, new Date(NaN))).toBeNull();
    expect(storyCardAvailable(HERE_AND_NOW, at("2026-11-11T01:00:00.000Z"))).toBe(true);
    expect(storyCardAvailable(HERE_AND_NOW, at("2026-11-14T10:00:00.000Z"))).toBe(false);
  });

  it("reads the event's own calendar: Perth, Adelaide and Brisbane while Melbourne is on another date", () => {
    // Sat 14 Nov 12:30 am in Melbourne; Fri 13 Nov 9:30 pm in Perth, 11:30 pm in Brisbane.
    const now = at("2026-11-13T13:30:00.000Z");
    expect(storyCardTag({ startsAt: "2026-11-15T12:00:00.000Z", timeZone: "Australia/Perth" }, now)).toBe("In 2 days");
    expect(storyCardTag({ startsAt: "2026-11-16T09:00:00.000Z", timeZone: "Australia/Brisbane" }, now)).toBe("In 3 days");
    expect(storyCardTag(melbourne("2026-11-16T09:00:00.000Z"), now)).toBe("In 2 days");
    // Fri 11:45 pm in Adelaide: its Sat 7 pm is tomorrow there (it's tonight by Melbourne's date).
    const adelaideNow = at("2026-11-13T13:15:00.000Z");
    expect(storyCardTag({ startsAt: "2026-11-14T08:30:00.000Z", timeZone: "Australia/Adelaide" }, adelaideNow)).toBe("Tomorrow");
    expect(storyCardTag(melbourne("2026-11-14T08:30:00.000Z"), adelaideNow)).toBe("Tonight");
  });

  it("holds across daylight saving both ways in Melbourne", () => {
    // 47 hours across the spring-forward (Sun 4 Oct 2026) and the fall-back (Sun 4 Apr 2027): 2 calendar days.
    expect(storyCardTag(melbourne("2026-10-04T11:00:00.000Z"), at("2026-10-02T12:00:00.000Z"))).toBe("In 2 days");
    expect(storyCardTag(melbourne("2027-04-04T11:00:00.000Z"), at("2027-04-02T12:00:00.000Z"))).toBe("In 2 days");
    // One calendar day is Tomorrow, whatever the hours (45.5 here).
    expect(storyCardTag(melbourne("2026-10-04T12:00:00.000Z"), at("2026-10-02T14:30:00.000Z"))).toBe("Tomorrow");
  });
});

describe("storyCardFreshSeconds", () => {
  it("at most an hour", () => {
    expect(storyCardFreshSeconds(HERE_AND_NOW, at("2026-11-10T23:00:00.000Z"))).toBe(3600); // Wed 10 am
  });

  it("ends at the next midnight in the event's zone, at the start and at the end", () => {
    expect(storyCardFreshSeconds(HERE_AND_NOW, at("2026-11-11T12:30:00.000Z"))).toBe(1800); // Wed 11:30 pm
    expect(storyCardFreshSeconds(HERE_AND_NOW, at("2026-11-14T05:50:00.000Z"))).toBe(600); // Tonight, 10 min before
    expect(storyCardFreshSeconds(HERE_AND_NOW, at("2026-11-14T09:40:00.000Z"))).toBe(1200); // On now, 20 min before the end
  });

  it("uses the event's midnight, not Melbourne's", () => {
    // Fri 11:30 pm in Perth is Sat 2:30 am in Melbourne: Perth's midnight is 30 minutes away.
    const perth: SoonFields = { startsAt: "2026-11-20T12:00:00.000Z", timeZone: "Australia/Perth" };
    expect(storyCardFreshSeconds(perth, at("2026-11-13T15:30:00.000Z"))).toBe(1800);
    // The same instant for a Melbourne event: its midnight has passed, so a whole hour.
    expect(storyCardFreshSeconds(melbourne("2026-11-20T12:00:00.000Z"), at("2026-11-13T15:30:00.000Z"))).toBe(3600);
  });

  it("never below 1 second", () => {
    expect(storyCardFreshSeconds(HERE_AND_NOW, at("2026-11-14T09:59:59.800Z"))).toBe(1);
    expect(storyCardFreshSeconds(melbourne("not a date"), at("2026-11-14T09:59:59.800Z"))).toBeGreaterThanOrEqual(1);
  });
});

describe("demoCardNow", () => {
  it("three days before the start when that's earlier than now, so a past sample still shows 'In 3 days'", () => {
    const demo = demoCardNow(HERE_AND_NOW, at("2026-12-01T00:00:00.000Z"));
    expect(demo.toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(storyCardTag(HERE_AND_NOW, demo)).toBe("In 3 days");
  });

  it("the real clock when it's earlier, or when the start can't be read", () => {
    expect(demoCardNow(HERE_AND_NOW, at("2026-10-01T00:00:00.000Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(demoCardNow(melbourne("nope"), at("2026-10-01T00:00:00.000Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

const EVENT: StoryCardEventFields = {
  title: "Here & Now",
  startsAt: "2026-11-14T06:00:00.000Z",
  endsAt: "2026-11-14T10:00:00.000Z",
  timeZone: "Australia/Melbourne",
  state: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
};

describe("storyCardText", () => {
  it("the ticket's date and time, and the venue with the bare suburb", () => {
    expect(storyCardText(EVENT)).toEqual({
      title: "Here & Now",
      date: "Sat 14 Nov",
      time: "5–9 pm",
      place: "Interconnect Studio, Coburg North",
    });
  });

  it("uses the ticket's time formats: no end, overnight, half hours", () => {
    expect(storyCardText({ ...EVENT, endsAt: undefined }).time).toBe("5 pm");
    expect(storyCardText({ ...EVENT, startsAt: "2026-11-14T10:00:00.000Z", endsAt: "2026-11-14T15:00:00.000Z" }).time).toBe("9 pm–2 am");
    expect(storyCardText({ ...EVENT, startsAt: "2026-11-14T08:30:00.000Z", endsAt: "2026-11-14T12:00:00.000Z" }).time).toBe("7:30–11 pm");
  });

  it("names the zone outside Melbourne's clock (Perth), and not for Sydney's, which reads the same", () => {
    const perth = storyCardText({ ...EVENT, startsAt: "2026-11-21T12:00:00.000Z", endsAt: undefined, timeZone: "Australia/Perth", state: "WA" });
    expect(perth.date).toBe("Sat 21 Nov");
    expect(perth.time).toBe("8 pm Perth time");
    expect(storyCardText({ ...EVENT, timeZone: "Australia/Sydney", state: "NSW" }).time).toBe("5–9 pm");
  });

  it("leaves out an empty venue or suburb, and a trailing state on the suburb", () => {
    expect(storyCardText({ ...EVENT, venueName: "  " }).place).toBe("Coburg North");
    expect(storyCardText({ ...EVENT, suburb: "" }).place).toBe("Interconnect Studio");
    expect(storyCardText({ ...EVENT, venueName: "", suburb: "" }).place).toBe("");
    expect(storyCardText({ ...EVENT, suburb: "Richmond NSW", state: "NSW", timeZone: "Australia/Sydney" }).place).toBe(
      "Interconnect Studio, Richmond",
    );
  });

  it("cuts the title at 80 characters, at a word, with an ellipsis", () => {
    const long = "The Extremely Long and Winding Annual Northside Celebration of Independent Zines and Prints";
    const { title } = storyCardText({ ...EVENT, title: long });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });

  it("removes emoji from the title, and keeps the title if nothing else is left", () => {
    expect(storyCardText({ ...EVENT, title: "🎷 Late Jazz 🌙✨ at the Corner" }).title).toBe("Late Jazz at the Corner");
    expect(storyCardText({ ...EVENT, title: "🎉🎉" }).title).toBe("🎉🎉");
  });
});

describe("stripEmoji", () => {
  it("removes pictographs with their joiners, variation selectors, skin tones, flags and keycaps", () => {
    expect(stripEmoji("Party 👩🏽‍🎤 time")).toBe("Party time");
    expect(stripEmoji("Love ❤️ songs")).toBe("Love songs");
    expect(stripEmoji("Aussie 🇦🇺 night")).toBe("Aussie night");
    expect(stripEmoji("Pick 1️⃣ now")).toBe("Pick 1 now");
  });

  it("keeps text, accents and the ©, ® and ™ our font draws", () => {
    expect(stripEmoji("Été à München")).toBe("Été à München");
    expect(stripEmoji("Brand™ Live® ©2026")).toBe("Brand™ Live® ©2026");
    expect(stripEmoji("Rock & Roll: 5–9 pm")).toBe("Rock & Roll: 5–9 pm");
  });
});

describe("storyCardTitleSize (wrapping steps)", () => {
  it("story: 128 up to 30 characters, then 112, 96 and 80", () => {
    expect(storyCardTitleSize("Here & Now", "story")).toBe(128);
    expect(storyCardTitleSize("The Long Night of Short Films", "story")).toBe(128); // 29
    expect(storyCardTitleSize("x".repeat(30), "story")).toBe(128);
    expect(storyCardTitleSize("x".repeat(31), "story")).toBe(112);
    expect(storyCardTitleSize("x".repeat(45), "story")).toBe(112);
    expect(storyCardTitleSize("x".repeat(46), "story")).toBe(96);
    expect(storyCardTitleSize("x".repeat(60), "story")).toBe(96);
    expect(storyCardTitleSize("x".repeat(61), "story")).toBe(80);
    expect(storyCardTitleSize("x".repeat(80), "story")).toBe(80);
  });

  it("square: 104, 92, 80 and 68 at the same steps", () => {
    expect(storyCardTitleSize("x".repeat(30), "square")).toBe(104);
    expect(storyCardTitleSize("x".repeat(45), "square")).toBe(92);
    expect(storyCardTitleSize("x".repeat(60), "square")).toBe(80);
    expect(storyCardTitleSize("x".repeat(61), "square")).toBe(68);
  });

  it("counts graphemes, not UTF-16 units: an accented letter written as two code points is one", () => {
    const decomposed = "É".repeat(30); // 30 graphemes, 60 code units
    expect(storyCardTitleSize(decomposed, "story")).toBe(128);
  });
});

describe("backdropMode", () => {
  it("strictly over 1.6 times the enlargement: exactly 1.6 is full-bleed", () => {
    expect(backdropMode(1600, 1200, "story")).toBe(false); // 1920 / 1200 = 1.6
    expect(backdropMode(1600, 1192, "story")).toBe(true); // 1.611
    expect(backdropMode(675, 675, "square")).toBe(false); // 1.6
    expect(backdropMode(670, 900, "square")).toBe(true); // 1.612
  });

  it("story and square differ: a 3:2 landscape cover is backdrop on the story, full-bleed on the post", () => {
    expect(backdropMode(1600, 1067, "story")).toBe(true);
    expect(backdropMode(1600, 1067, "square")).toBe(false);
  });

  it("the sample photos: 724×522 is backdrop, 1440×1440 full-bleed", () => {
    expect(backdropMode(724, 522, "story")).toBe(true);
    expect(backdropMode(1440, 1440, "story")).toBe(false);
  });

  it("uses the sides it's given (the caller passes them after EXIF rotation)", () => {
    // A 1200 × 1600 portrait stored sideways reads 1600 × 1200 before rotation.
    expect(backdropMode(1200, 1600, "story")).toBe(false);
    expect(backdropMode(900, 1600, "story")).toBe(false);
    expect(backdropMode(1600, 900, "story")).toBe(true);
  });

  it("false for a size that isn't one", () => {
    expect(backdropMode(0, 100, "story")).toBe(false);
    expect(backdropMode(NaN, 100, "story")).toBe(false);
  });
});

/** WCAG contrast of two sRGB colours. */
function contrast(a: Rgb, b: Rgb): number {
  const lum = ({ r, g, b: bl }: Rgb) => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL of an sRGB colour (for checking the rule's caps). */
function hsl({ r, g, b }: Rgb) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  return { h, s, l };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

describe("toneFromMean", () => {
  it("a grey has no saturation: rgb(33, 33, 33) and rgb(199, 199, 199)", () => {
    expect(toneFromMean(128, 128, 128)).toEqual({ tone: { r: 33, g: 33, b: 33 }, light: { r: 199, g: 199, b: 199 } });
    expect(toneFromMean(250, 250, 250)).toEqual(toneFromMean(5, 5, 5));
  });

  it("keeps the hue of a warm and a teal mean, saturation capped at 0.32 and 0.20, lightness fixed", () => {
    for (const [r, g, b, hue] of [
      [200, 120, 60, 26], // warm: an orange roof
      [30, 110, 120, 187], // teal: record crates
    ]) {
      const { tone, light } = toneFromMean(r, g, b);
      const t = hsl(tone);
      const l = hsl(light);
      expect(Math.abs(t.h - hue)).toBeLessThan(4);
      expect(Math.abs(l.h - hue)).toBeLessThan(4);
      expect(t.s).toBeLessThanOrEqual(0.32 + 0.02);
      expect(t.s).toBeGreaterThan(0.25);
      expect(t.l).toBeCloseTo(0.13, 2);
      expect(l.s).toBeLessThanOrEqual(0.2 + 0.01);
      expect(l.l).toBeCloseTo(0.78, 2);
    }
  });

  it("a low saturation is kept, not raised to the cap", () => {
    expect(hsl(toneFromMean(140, 128, 120).tone).s).toBeLessThan(0.12);
  });

  it("white on the tone is at least 14:1, and the light tone on it about 9:1, at every hue", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      // A fully saturated mean of this hue.
      const c = (n: number) => {
        const k = (n + hue / 30) % 12;
        return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
      };
      const { tone, light } = toneFromMean(c(0), c(8), c(4));
      expect(contrast(WHITE, tone)).toBeGreaterThanOrEqual(14);
      expect(contrast(light, tone)).toBeGreaterThanOrEqual(8.5);
    }
  });

  it("the fallback tone for a mean that isn't a number", () => {
    expect(toneFromMean(NaN, 0, 0)).toBe(FALLBACK_TONE);
  });

  it("rgbCss writes rgb() and rgba()", () => {
    expect(rgbCss({ r: 1, g: 2, b: 3 })).toBe("rgb(1, 2, 3)");
    expect(rgbCss({ r: 1, g: 2, b: 3 }, 0.72)).toBe("rgba(1, 2, 3, 0.72)");
    expect(rgbCss({ r: 1, g: 2, b: 3 }, 0)).toBe("rgba(1, 2, 3, 0)");
  });
});

describe("storyCardVersion", () => {
  const base: StoryCardVersionInput = {
    format: "story",
    text: storyCardText(EVENT),
    tag: "In 3 days",
    imageVersion: "1731000000000",
    focus: { x: 50, y: 30 },
  };

  it("is stable for the same inputs", () => {
    expect(storyCardVersion(base)).toBe(storyCardVersion({ ...base, text: { ...base.text } }));
  });

  it("changes with each thing the card shows", () => {
    const changed: StoryCardVersionInput[] = [
      { ...base, format: "square" },
      { ...base, text: { ...base.text, title: "Here & Then" } },
      { ...base, text: { ...base.text, date: "Sun 15 Nov" } },
      { ...base, text: { ...base.text, time: "6–9 pm" } },
      { ...base, text: { ...base.text, place: "Elsewhere, Coburg North" } },
      { ...base, tag: "In 2 days" },
      { ...base, imageVersion: "1731000000001" },
      { ...base, imageVersion: null },
      { ...base, focus: { x: 50, y: 31 } },
      { ...base, focus: null },
    ];
    const versions = new Set([storyCardVersion(base), ...changed.map(storyCardVersion)]);
    expect(versions.size).toBe(changed.length + 1);
  });
});

describe("paths and names", () => {
  it("the card's path: page-level, no image extension, the format as its only parameter", () => {
    expect(storyCardPath("neon-static", "story")).toBe("/events/neon-static/story-card?format=story");
    expect(storyCardPath("neon-static", "square")).toBe("/events/neon-static/story-card?format=square");
    expect(storyCardPath("a b", "story")).toBe("/events/a%20b/story-card?format=story");
  });

  it("the file name", () => {
    expect(storyCardFileName("neon-static", "story")).toBe("sheltuh-neon-static-story.jpg");
    expect(storyCardFileName("neon-static", "square")).toBe("sheltuh-neon-static-square.jpg");
  });

  it("isStoryCardFormat", () => {
    expect(isStoryCardFormat("story")).toBe(true);
    expect(isStoryCardFormat("square")).toBe(true);
    expect(isStoryCardFormat("post")).toBe(false);
    expect(isStoryCardFormat(undefined)).toBe(false);
  });
});
