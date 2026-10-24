import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIP_MESSAGES } from "@/lib/clip-rules";
import {
  clipProblemMessage,
  inspectClip,
  MAX_BOXES,
  MAX_CLIP_BYTES,
  MAX_CLIP_DURATION_MS,
  MAX_FTYP_BYTES,
  sanitiseClip,
  type ClipCheck,
} from "@/lib/server/mp4";

// ---------------------------------------------------------------------------
// A synthetic ISO-BMFF builder: just enough boxes for the parser's checks.
// ---------------------------------------------------------------------------

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function u16(n: number) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n);
  return out;
}
function u32(n: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}
function u64(n: bigint) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n);
  return out;
}
const zeros = (n: number) => new Uint8Array(n);

/** A box with a 32-bit size. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(8 + body.length), latin1(type), body);
}

/** A box with a 64-bit size (size field 1). */
function largeBox(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(u32(1), latin1(type), u64(BigInt(16 + body.length)), body);
}

function fullBox(type: string, version: number, ...payload: Uint8Array[]): Uint8Array {
  return box(type, Uint8Array.of(version, 0, 0, 0), ...payload);
}

function ftyp(major = "isom", compatible = ["isom", "iso2", "avc1", "mp41"]) {
  return box("ftyp", latin1(major), u32(512), ...compatible.map(latin1));
}

interface Timing {
  version?: 0 | 1;
  timescale?: number;
  duration?: number | bigint;
  /** Creation and modification times set (a recognisable pattern), as a camera writes them. */
  stamped?: boolean;
}

/** Creation and modification times: `n` bytes of a pattern no other field here uses, or zeros. */
const STAMP = 0xa7;
const times = (n: number, stamped = false) => (stamped ? new Uint8Array(n).fill(STAMP) : zeros(n));

function mvhd({ version = 0, timescale = 1000, duration = 10_000, stamped }: Timing = {}) {
  const d = BigInt(duration);
  return version === 0
    ? fullBox("mvhd", 0, times(8, stamped), u32(timescale), u32(Number(d)), zeros(80))
    : fullBox("mvhd", 1, times(16, stamped), u32(timescale), u64(d), zeros(80));
}

function mdhd({ version = 0, timescale = 12_800, duration = 128_000, stamped }: Timing = {}) {
  const d = BigInt(duration);
  return version === 0
    ? fullBox("mdhd", 0, times(8, stamped), u32(timescale), u32(Number(d)), zeros(4))
    : fullBox("mdhd", 1, times(16, stamped), u32(timescale), u64(d), zeros(4));
}

/** tkhd's matrix {a, b, u, c, d, v, x, y, w}: identity, and a 90° turn as phones write it. */
const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
const TURN_90 = [0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000];

function i32(n: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n);
  return out;
}

function tkhd(width: number, height: number, version: 0 | 1 = 0, matrix?: number[], stamped = false) {
  // Everything before the matrix (the times first), the matrix (36), then width and height (16.16).
  const before = version === 0 ? concat(times(8, stamped), zeros(12 + 8 + 8)) : concat(times(16, stamped), zeros(16 + 8 + 8));
  const m = matrix ? concat(...matrix.map(i32)) : zeros(36);
  return fullBox("tkhd", version, before, m, u32(width * 65536), u32(height * 65536));
}

function hdlr(handler: string, name = "Handler\0") {
  return fullBox("hdlr", 0, zeros(4), latin1(handler), zeros(12), latin1(name));
}

/** A VisualSampleEntry (78 bytes), an avcC/hvcC-ish child, and any more children (or trailing bytes). */
function videoEntry(type: string, width: number, height: number, extra: Uint8Array[] = []) {
  return box(type, zeros(6), u16(1), zeros(16), u16(width), u16(height), zeros(50), box("avcC", zeros(8)), ...extra);
}

function audioEntry() {
  return box("mp4a", zeros(6), u16(1), zeros(20), box("esds", zeros(8)));
}

interface TrackSpec {
  handler?: string;
  entry?: string;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  mdhd?: Timing;
  tkhdVersion?: 0 | 1;
  matrix?: number[];
  entries?: number;
  trakExtra?: Uint8Array[];
  stblExtra?: Uint8Array[];
  /** Boxes in minf after stbl. */
  minfExtra?: Uint8Array[];
  /** After the sample entry's avcC. */
  entryExtra?: Uint8Array[];
  /** The media hdlr's name. */
  handlerName?: string;
  tkhdStamped?: boolean;
}

function trak(spec: TrackSpec, chunkOffset: number) {
  const handler = spec.handler ?? "vide";
  const width = spec.width ?? 1280;
  const height = spec.height ?? 720;
  const entry = handler === "soun" ? audioEntry() : videoEntry(spec.entry ?? "avc1", width, height, spec.entryExtra);
  const entries = spec.entries ?? 1;
  const stsd = fullBox("stsd", 0, u32(entries), ...Array.from({ length: entries }, () => entry));
  const stbl = box(
    "stbl",
    stsd,
    fullBox("stts", 0, u32(1), u32(10), u32(12_800)),
    fullBox("stsc", 0, u32(1), u32(1), u32(10), u32(1)),
    fullBox("stsz", 0, u32(4), u32(10)),
    fullBox("stco", 0, u32(1), u32(chunkOffset)),
    ...(spec.stblExtra ?? []),
  );
  const minf = box(
    "minf",
    fullBox("vmhd", 0, zeros(8)),
    box("dinf", fullBox("dref", 0, u32(0))),
    stbl,
    ...(spec.minfExtra ?? []),
  );
  const mdia = box("mdia", mdhd(spec.mdhd), hdlr(handler, spec.handlerName), minf);
  return box(
    "trak",
    tkhd(spec.displayWidth ?? width, spec.displayHeight ?? height, spec.tkhdVersion ?? 0, spec.matrix, spec.tkhdStamped),
    mdia,
    ...(spec.trakExtra ?? []),
  );
}

interface ClipSpec {
  ftyp?: Uint8Array;
  mvhd?: Timing;
  tracks?: TrackSpec[];
  /** Boxes in moov after mvhd and the tracks. */
  moovExtra?: Uint8Array[];
  /** Top-level boxes between ftyp and moov. */
  topExtra?: Uint8Array[];
  /** Replaces the mdat. */
  mdat?: (payload: Uint8Array) => Uint8Array;
  /** Top-level boxes after mdat. */
  tail?: Uint8Array[];
}

/** The media data: recognisable bytes, so a test can see they're untouched. */
const MEDIA = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);

/** A whole clip: ftyp, extras, moov, mdat (its stco offset pointing at the media data). */
function clip(spec: ClipSpec = {}): Uint8Array {
  const build = (offset: number) => {
    const head = concat(spec.ftyp ?? ftyp(), ...(spec.topExtra ?? []));
    const moov = box(
      "moov",
      mvhd(spec.mvhd),
      ...(spec.tracks ?? [{}]).map((t) => trak(t, offset)),
      ...(spec.moovExtra ?? []),
    );
    const mdat = (spec.mdat ?? ((p) => box("mdat", p)))(MEDIA);
    return { head, moov, mdat };
  };
  const first = build(0);
  const mdatHeader = first.mdat.length - MEDIA.length;
  const { head, moov, mdat } = build(first.head.length + first.moov.length + mdatHeader);
  return concat(head, moov, mdat, ...(spec.tail ?? []));
}

function expectRefused(result: ClipCheck, problem: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.problem).toBe(problem);
}

function indexOf(haystack: Uint8Array, needle: Uint8Array | string): number {
  return Buffer.from(haystack).indexOf(Buffer.from(typeof needle === "string" ? latin1(needle) : needle));
}

// ---------------------------------------------------------------------------

describe("inspectClip: accepted clips", () => {
  it("accepts one H.264 (avc1) video track and reports its length and size", () => {
    expect(inspectClip(clip())).toEqual({
      ok: true,
      info: {
        durationMs: 10_000,
        width: 1280,
        height: 720,
        codedWidth: 1280,
        codedHeight: 720,
        codec: "avc1",
        majorBrand: "isom",
      },
    });
  });

  it("accepts avc3, version 1 mvhd, mdhd and tkhd, and 64-bit box sizes", () => {
    const bytes = clip({
      mvhd: { version: 1, timescale: 600, duration: BigInt(9_000) },
      tracks: [{ entry: "avc3", mdhd: { version: 1, timescale: 90_000, duration: BigInt(1_350_000) }, tkhdVersion: 1 }],
      mdat: (p) => largeBox("mdat", p),
    });
    const result = inspectClip(bytes);
    expect(result).toMatchObject({ ok: true, info: { codec: "avc3", durationMs: 15_000, width: 1280 } });
  });

  it("accepts QuickTime-branded files, and a known brand that's only compatible", () => {
    expect(inspectClip(clip({ ftyp: ftyp("qt  ", ["qt  "]) }))).toMatchObject({ ok: true, info: { majorBrand: "qt  " } });
    expect(inspectClip(clip({ ftyp: ftyp("XAVC", ["XAVC", "mp42"]) }))).toMatchObject({ ok: true });
  });

  it("accepts a last mdat of size 0 (to the end of the file)", () => {
    const bytes = clip({ mdat: (p) => concat(u32(0), latin1("mdat"), p) });
    expect(inspectClip(bytes).ok).toBe(true);
  });

  it("accepts exactly 15.5 s and rounds the length up to the millisecond", () => {
    expect(inspectClip(clip({ mvhd: { timescale: 1000, duration: MAX_CLIP_DURATION_MS } }))).toMatchObject({
      ok: true,
      info: { durationMs: 15_500 },
    });
    // 1001/30000 s is 33.3667 ms: rounded up, never down.
    expect(
      inspectClip(clip({ mvhd: { timescale: 30_000, duration: 1001 }, tracks: [{ mdhd: { timescale: 30_000, duration: 1001 } }] })),
    ).toMatchObject({ ok: true, info: { durationMs: 34 } });
  });

  it("accepts portrait 1080 × 1920", () => {
    expect(inspectClip(clip({ tracks: [{ width: 1080, height: 1920 }] }))).toMatchObject({
      ok: true,
      info: { width: 1080, height: 1920 },
    });
  });

  it("reports the size as shown: tkhd's matrix turning a landscape-stored clip portrait", () => {
    for (const tkhdVersion of [0, 1] as const) {
      expect(inspectClip(clip({ tracks: [{ width: 1920, height: 1080, matrix: TURN_90, tkhdVersion }] }))).toMatchObject({
        ok: true,
        info: { width: 1080, height: 1920, codedWidth: 1920, codedHeight: 1080 },
      });
    }
    expect(inspectClip(clip({ tracks: [{ width: 1280, height: 720, matrix: IDENTITY }] }))).toMatchObject({
      ok: true,
      info: { width: 1280, height: 720 },
    });
  });

  it("falls back to the coded size when tkhd gives none", () => {
    expect(inspectClip(clip({ tracks: [{ width: 640, height: 360, displayWidth: 0, displayHeight: 0 }] }))).toMatchObject({
      ok: true,
      info: { width: 640, height: 360 },
    });
  });

  it("doesn't change the bytes", () => {
    const bytes = clip({ topExtra: [box("udta", box("©xyz", latin1("+37.8136+144.9631/")))] });
    const copy = bytes.slice();
    expect(inspectClip(bytes).ok).toBe(true);
    expect(bytes).toEqual(copy);
  });
});

describe("inspectClip: refused clips", () => {
  it("refuses anything over 15.5 s, in mvhd or in mdhd", () => {
    expectRefused(inspectClip(clip({ mvhd: { timescale: 1000, duration: MAX_CLIP_DURATION_MS + 1 } })), "too_long");
    expectRefused(inspectClip(clip({ mvhd: { version: 1, timescale: 1, duration: BigInt(2 ** 40) } })), "too_long");
    expectRefused(inspectClip(clip({ tracks: [{ mdhd: { timescale: 12_800, duration: 12_800 * 16 } }] })), "too_long");
    const result = inspectClip(clip({ mvhd: { timescale: 1000, duration: 18_400 } }));
    expectRefused(result, "too_long");
    // The spec's copy, with the clip's own length (rounded) in it.
    if (!result.ok) {
      expect(result.message).toBe("This clip is 18 seconds. Clips can be up to 15 seconds: trim it and try again.");
    }
  });

  it("refuses a zero, unknown or timescale-less duration", () => {
    expectRefused(inspectClip(clip({ mvhd: { duration: 0 } })), "no_duration");
    expectRefused(inspectClip(clip({ mvhd: { duration: 0xffffffff } })), "no_duration");
    expectRefused(inspectClip(clip({ mvhd: { version: 1, duration: BigInt("0xffffffffffffffff") } })), "no_duration");
    expectRefused(inspectClip(clip({ mvhd: { timescale: 0 } })), "no_duration");
    expectRefused(inspectClip(clip({ tracks: [{ mdhd: { duration: 0 } }] })), "no_duration");
  });

  it("refuses HEVC with H.264 / Most Compatible guidance", () => {
    for (const entry of ["hvc1", "hev1", "dvh1"]) {
      const result = inspectClip(clip({ tracks: [{ entry }] }));
      expectRefused(result, "hevc");
      if (!result.ok) expect(result.message).toBe(CLIP_MESSAGES.hevc);
    }
  });

  it("refuses other video codecs", () => {
    for (const entry of ["mp4v", "av01", "vp09", "apcn"]) expectRefused(inspectClip(clip({ tracks: [{ entry }] })), "codec");
  });

  it("refuses any audio track (clips never have sound)", () => {
    const result = inspectClip(clip({ tracks: [{}, { handler: "soun" }] }));
    expectRefused(result, "audio");
    if (!result.ok) expect(result.message).toBe("Clips can’t have sound — export without audio.");
    // Audio only: no video, and the audio.
    const audioOnly = inspectClip(clip({ tracks: [{ handler: "soun" }] }));
    expect(audioOnly).toMatchObject({ ok: false, problem: "no_video", problems: ["no_video", "audio"] });
  });

  it("refuses timed metadata, timecode, text and a second video track", () => {
    for (const handler of ["meta", "tmcd", "text", "subt", "sbtl", "hint"]) {
      expectRefused(inspectClip(clip({ tracks: [{}, { handler, entry: "mebx" }] })), "extra_track");
    }
    expectRefused(inspectClip(clip({ tracks: [{}, {}] })), "extra_track");
  });

  it("lists every refusal at once, most fundamental first", () => {
    const result = inspectClip(clip({ mvhd: { duration: 20_000 }, tracks: [{ entry: "hvc1" }, { handler: "soun" }] }));
    expect(result).toMatchObject({ ok: false, problem: "hevc", problems: ["hevc", "audio", "too_long"] });
    if (!result.ok) {
      expect(result.message).toBe(
        [CLIP_MESSAGES.hevc, CLIP_MESSAGES.audio, CLIP_MESSAGES.tooLong(20_000)].join(" "),
      );
    }
  });

  it("refuses frames over about 2.1 megapixels, coded or displayed", () => {
    expectRefused(inspectClip(clip({ tracks: [{ width: 3840, height: 2160 }] })), "too_many_pixels");
    expectRefused(inspectClip(clip({ tracks: [{ displayWidth: 2560, displayHeight: 1440 }] })), "too_many_pixels");
    expectRefused(inspectClip(clip({ tracks: [{ width: 0, height: 720 }] })), "malformed");
    // Few pixels, but a strip: no side over MAX_CLIP_SIDE.
    expectRefused(inspectClip(clip({ tracks: [{ width: 640, height: 360, displayWidth: 8192, displayHeight: 2 }] })), "too_many_pixels");
  });

  it("says what the spec says for each problem (docs/design/event-clips.md §5.4)", () => {
    const unreadable = "We couldn’t read this clip. Export it again as MP4 (H.264) and try again.";
    expect(clipProblemMessage("not_mp4")).toBe("This file isn’t an MP4 or MOV video. Export it as MP4 (H.264) and try again.");
    expect(clipProblemMessage("webm")).toBe(clipProblemMessage("not_mp4"));
    expect(clipProblemMessage("hevc")).toBe(
      "This clip is HEVC, which many phones and browsers can’t play. Export as H.264 / Most Compatible and try again.",
    );
    expect(clipProblemMessage("too_long", { durationMs: 15_600 })).toBe(
      "This clip is 16 seconds. Clips can be up to 15 seconds: trim it and try again.",
    );
    expect(clipProblemMessage("too_large", { sizeBytes: 12.3 * 1024 * 1024 })).toBe(
      "This clip is 12.3 MB. Clips can be up to 10 MB: export at 1080p or lower and try again.",
    );
    expect(clipProblemMessage("too_many_pixels")).toBe("This clip is bigger than 1080p. Export at 1080p or lower and try again.");
    expect(clipProblemMessage("audio")).toBe("Clips can’t have sound — export without audio.");
    for (const problem of ["malformed", "too_complex", "fragmented", "no_video", "codec", "extra_track", "no_duration"] as const) {
      expect(clipProblemMessage(problem)).toBe(unreadable);
    }
  });

  it("says each distinct message once", () => {
    const result = inspectClip(clip({ tracks: [{ entry: "vp09" }, { handler: "tmcd", entry: "tmcd" }] }));
    expect(result).toMatchObject({ ok: false, problems: ["codec", "extra_track"] });
    if (!result.ok) expect(result.message).toBe(CLIP_MESSAGES.unreadable);
  });

  it("refuses WebM, other files, and anything over the size cap", () => {
    expectRefused(inspectClip(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1)), "webm");
    expectRefused(inspectClip(new Uint8Array(0)), "not_mp4");
    expectRefused(inspectClip(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)), "not_mp4");
    expectRefused(inspectClip(latin1("<html><body>not a video</body></html>")), "not_mp4");
    // A HEIF photo: ISO-BMFF, but no brand of ours.
    expectRefused(inspectClip(clip({ ftyp: ftyp("heic", ["mif1", "heic"]) })), "not_mp4");
    const big = new Uint8Array(MAX_CLIP_BYTES + 1);
    big.set(clip());
    const tooBig = inspectClip(big);
    expectRefused(tooBig, "too_large");
    if (!tooBig.ok) expect(tooBig.message).toBe(CLIP_MESSAGES.tooLarge(MAX_CLIP_BYTES + 1));
  });

  it("refuses an ftyp that isn't first, a second ftyp, or a ragged one", () => {
    expectRefused(inspectClip(concat(box("free"), clip())), "not_mp4");
    expectRefused(inspectClip(clip({ topExtra: [ftyp()] })), "not_mp4");
    expectRefused(inspectClip(clip({ ftyp: box("ftyp", latin1("isom"), u32(0), latin1("is")) })), "malformed");
  });

  it("refuses an ftyp over MAX_FTYP_BYTES, whatever brands it lists", () => {
    expect(MAX_FTYP_BYTES).toBe(1024);
    // 1,024 bytes in all (8 of header, 8 of major brand and version, 252 compatible brands): accepted.
    const unknown = (n: number) => Array.from({ length: n }, () => "zzzz");
    expect(inspectClip(clip({ ftyp: ftyp("zzzz", [...unknown(251), "isom"]) })).ok).toBe(true);
    // One more brand: refused, even with a known major brand.
    expectRefused(inspectClip(clip({ ftyp: ftyp("isom", [...unknown(252), "isom"]) })), "malformed");
    // A 64-bit-sized ftyp of 9 MB: refused before any brand is read.
    const huge = concat(u32(1), latin1("ftyp"), u64(BigInt(16 + 8 + 9 * 1024 * 1024)), latin1("isom"), u32(0), zeros(9 * 1024 * 1024));
    expectRefused(inspectClip(concat(huge, clip().subarray(ftyp().length))), "malformed");
  });

  it("refuses every truncation of a good file", () => {
    const bytes = clip({ topExtra: [box("udta", box("©xyz", latin1("+37.8136+144.9631/")))] });
    for (let length = 0; length < bytes.length; length++) {
      const result = inspectClip(bytes.subarray(0, length));
      expect(result.ok, `cut at ${length}`).toBe(false);
    }
  });

  it("refuses a box that runs past its parent, or overlaps the next", () => {
    const bytes = clip();
    // Grow the trak by 8 bytes: it now runs past the end of the moov.
    const trakAt = indexOf(bytes, "trak") - 4;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    view.setUint32(trakAt, view.getUint32(trakAt) + 8);
    expectRefused(inspectClip(bytes), "malformed");

    // The moov claiming more than the file.
    const moovRunsOver = clip();
    const moovAt = indexOf(moovRunsOver, "moov") - 4;
    new DataView(moovRunsOver.buffer).setUint32(moovAt, moovRunsOver.length);
    expectRefused(inspectClip(moovRunsOver), "malformed");
  });

  it("refuses sizes below the header, and 64-bit sizes that are too small or too large", () => {
    const tiny = clip();
    const at = indexOf(tiny, "mvhd") - 4;
    new DataView(tiny.buffer).setUint32(at, 4);
    expectRefused(inspectClip(tiny), "malformed");

    const huge = clip({ mdat: (p) => concat(u32(1), latin1("mdat"), u32(1), u32(16 + p.length), p) });
    expectRefused(inspectClip(huge), "malformed");
    const small = clip({ mdat: (p) => concat(u32(1), latin1("mdat"), u64(BigInt(8)), p) });
    expectRefused(inspectClip(small), "malformed");
    // A uuid box too small for its 16-byte user type.
    expectRefused(inspectClip(clip({ topExtra: [box("uuid", zeros(8))] })), "malformed");
  });

  it("refuses a size-0 box anywhere but a top-level mdat", () => {
    // In the moov.
    expectRefused(inspectClip(clip({ moovExtra: [concat(u32(0), latin1("udta"))] })), "malformed");
    // At the top level, but not the mdat.
    expectRefused(inspectClip(clip({ tail: [concat(u32(0), latin1("free"), zeros(8))] })), "malformed");
    // A size-0 mdat before the moov swallows it: no moov.
    const swallowed = concat(ftyp(), u32(0), latin1("mdat"), clip().subarray(ftyp().length));
    expectRefused(inspectClip(swallowed), "malformed");
  });

  it("refuses two moov boxes, no moov, no mdat, and missing mandatory boxes", () => {
    const one = clip();
    const moov = one.subarray(indexOf(one, "moov") - 4, indexOf(one, "mdat") - 4);
    expectRefused(inspectClip(clip({ topExtra: [moov] })), "malformed");
    expectRefused(inspectClip(concat(ftyp(), box("mdat", MEDIA))), "malformed");
    expectRefused(inspectClip(clip({ mdat: () => box("free") })), "malformed");
    expectRefused(inspectClip(concat(ftyp(), box("moov", trak({}, 0)), box("mdat", MEDIA))), "malformed");
  });

  it("refuses fragmented files", () => {
    expectRefused(inspectClip(clip({ tail: [box("moof", fullBox("mfhd", 0, u32(1)))] })), "fragmented");
    expectRefused(inspectClip(clip({ moovExtra: [box("mvex", fullBox("trex", 0, zeros(20)))] })), "fragmented");
    expectRefused(inspectClip(clip({ topExtra: [fullBox("sidx", 0, zeros(24))] })), "fragmented");
  });

  it("refuses more than one sample description", () => {
    expectRefused(inspectClip(clip({ tracks: [{ entries: 2 }] })), "too_complex");
  });

  it("caps the number of boxes it reads", () => {
    const pads = (n: number) => Array.from({ length: n }, () => box("free"));
    // Comfortably under: accepted.
    expect(inspectClip(clip({ moovExtra: pads(MAX_BOXES - 100) })).ok).toBe(true);
    expectRefused(inspectClip(clip({ moovExtra: pads(MAX_BOXES) })), "too_complex");
    expectRefused(inspectClip(clip({ topExtra: pads(MAX_BOXES) })), "too_complex");
  });

  it("never enters deeply nested boxes it doesn't need", () => {
    // 2,000 udta boxes, each inside the last, in the moov: not walked, just neutralised.
    const depth = 2000;
    const nested = new Uint8Array(depth * 8 + 18);
    const view = new DataView(nested.buffer);
    for (let level = 0; level < depth; level++) {
      view.setUint32(level * 8, nested.length - level * 8);
      nested.set(latin1("udta"), level * 8 + 4);
    }
    nested.set(latin1("+37.8136+144.9631/"), depth * 8);
    const bytes = clip({ moovExtra: [nested] });
    expect(inspectClip(bytes).ok).toBe(true);
    expect(sanitiseClip(bytes).ok).toBe(true);
    expect(indexOf(bytes, "+37.8136")).toBe(-1);
  });
});

describe("sanitiseClip", () => {
  /** A clip with location, device and XMP metadata everywhere a phone or editor puts it. */
  function plantedClip() {
    const xmpUuid = Uint8Array.of(0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac);
    return clip({
      topExtra: [
        box("uuid", xmpUuid, latin1("<exif:GPSLatitude>37,48.8N</exif:GPSLatitude>")),
        box("free", latin1("left-over Model=iPhone 15 Pro")),
      ],
      moovExtra: [
        box("udta", box("©xyz", u16(18), u16(0x15c7), latin1("+37.8136+144.9631/")), box("©mak", latin1("Apple"))),
        fullBox(
          "meta",
          0,
          hdlr("mdta"),
          box("keys", u32(1), box("mdta", latin1("com.apple.quicktime.location.ISO6709"))),
          box("ilst", box("data", latin1("+37.8136+144.9631+010.000/"))),
        ),
        box("prfl", latin1("unknown moov child with a serial SN-12345")),
        box("iods", zeros(8)),
      ],
      tracks: [
        {
          trakExtra: [box("udta", box("©mod", latin1("iPhone 15 Pro")))],
          stblExtra: [fullBox("stss", 0, u32(1), u32(1))],
        },
      ],
      tail: [largeBox("udta", box("loci", latin1("Fitzroy, Melbourne")))],
    });
  }

  it("rewrites every metadata box as a zeroed free box of the same size, keeping length and media data", () => {
    const bytes = plantedClip();
    const before = bytes.slice();
    const mdatAt = indexOf(before, MEDIA);
    const stcoAt = indexOf(before, "stco");
    const stcoOffset = new DataView(before.buffer).getUint32(stcoAt + 12);
    expect(stcoOffset).toBe(mdatAt);

    const result = sanitiseClip(bytes);
    expect(result).toEqual(inspectClip(before));
    expect(result.ok).toBe(true);
    expect(bytes.length).toBe(before.length);

    // Media data and the chunk offset pointing at it: untouched.
    expect(bytes.subarray(mdatAt, mdatAt + MEDIA.length)).toEqual(MEDIA);
    expect(new DataView(bytes.buffer).getUint32(stcoAt + 12)).toBe(stcoOffset);
    // The sample tables and the needed moov children: untouched.
    for (const kept of ["stss", "iods", "tkhd", "mvhd", "stsd", "avcC"]) {
      const at = indexOf(before, kept);
      const size = new DataView(before.buffer).getUint32(at - 4);
      expect(bytes.subarray(at - 4, at - 4 + size), kept).toEqual(before.subarray(at - 4, at - 4 + size));
    }

    // Nothing of the metadata is left.
    for (const gone of [
      "+37.8136",
      "GPSLatitude",
      "ISO6709",
      "iPhone 15 Pro",
      "SN-12345",
      "Fitzroy",
      "©xyz",
      "©mak",
      "udta",
      "meta",
      "uuid",
      "prfl",
    ]) {
      expect(indexOf(bytes, gone), gone).toBe(-1);
    }
  });

  it("keeps each neutralised box's size fields, 32- or 64-bit", () => {
    const bytes = plantedClip();
    const before = bytes.slice();
    // The tail's udta, with a 64-bit size.
    const tailAt = indexOf(before, Uint8Array.of(0, 0, 0, 1, ...latin1("udta")));
    expect(tailAt).toBeGreaterThan(0);
    sanitiseClip(bytes);
    expect(bytes.subarray(tailAt, tailAt + 16)).toEqual(concat(u32(1), latin1("free"), before.subarray(tailAt + 8, tailAt + 16)));
    expect(bytes.subarray(tailAt + 16).every((b) => b === 0)).toBe(true);
    // The result still passes, with the same details.
    expect(inspectClip(bytes)).toEqual(inspectClip(before));
  });

  it("zeroes padding boxes' payloads but keeps their type", () => {
    const bytes = clip({ topExtra: [box("free", latin1("secret")), box("skip", latin1("secret")), box("wide")] });
    sanitiseClip(bytes);
    expect(indexOf(bytes, "secret")).toBe(-1);
    expect(indexOf(bytes, "skip")).toBeGreaterThan(0);
    expect(indexOf(bytes, "wide")).toBeGreaterThan(0);
  });

  it("zeroes the capture times in mvhd, tkhd and mdhd, both versions, keeping everything else", () => {
    for (const version of [0, 1] as const) {
      const bytes = clip({
        mvhd: { version, stamped: true },
        tracks: [{ mdhd: { version, stamped: true }, tkhdVersion: version, tkhdStamped: true }],
      });
      const before = bytes.slice();
      const stamp = new Uint8Array(version === 1 ? 16 : 8).fill(STAMP);
      expect(indexOf(before, stamp), `version ${version}`).toBeGreaterThan(0);
      const result = sanitiseClip(bytes);
      expect(result).toEqual(inspectClip(before));
      expect(result.ok).toBe(true);
      expect(bytes.length).toBe(before.length);
      expect(bytes.includes(STAMP), `version ${version}`).toBe(false);
      // Only the times changed (and the handler's name, blanked too): the same bytes with them zeroed.
      const expected = before.slice();
      for (const type of ["mvhd", "tkhd", "mdhd"]) {
        const at = indexOf(before, type) + 4 + 4;
        expected.fill(0, at, at + (version === 1 ? 16 : 8));
      }
      const hdlrAt = indexOf(before, "hdlr") - 4;
      expected.fill(0, hdlrAt + 32, hdlrAt + new DataView(before.buffer).getUint32(hdlrAt));
      expect(bytes).toEqual(expected);
    }
  });

  it("blanks every handler name it reads, keeping the handler type and the box's size", () => {
    const bytes = clip({
      tracks: [
        {
          handlerName: "Planted Camera App\0",
          minfExtra: [hdlr("alis", "Planted Data Handler\0")],
        },
      ],
    });
    const before = bytes.slice();
    expect(sanitiseClip(bytes)).toEqual(inspectClip(before));
    expect(bytes.length).toBe(before.length);
    expect(indexOf(bytes, "Planted")).toBe(-1);
    expect(indexOf(bytes, "hdlr")).toBe(indexOf(before, "hdlr"));
    expect(indexOf(bytes, "vide")).toBe(indexOf(before, "vide"));
    expect(indexOf(bytes, "alis")).toBe(indexOf(before, "alis"));
    const at = indexOf(before, "hdlr") - 4;
    const size = new DataView(before.buffer).getUint32(at);
    expect(bytes.subarray(at, at + 32)).toEqual(before.subarray(at, at + 32));
    expect(bytes.subarray(at + 32, at + size).every((b) => b === 0)).toBe(true);
  });

  it("neutralises metadata among the H.264 sample entry's children, keeping avcC and the rest", () => {
    const bytes = clip({
      tracks: [
        {
          entryExtra: [
            box("pasp", u32(1), u32(1)),
            box("uuid", zeros(16), latin1("Planted encoder serial SN-999")),
            box("udta", latin1("Planted")),
          ],
        },
      ],
    });
    const before = bytes.slice();
    expect(sanitiseClip(bytes)).toEqual(inspectClip(before));
    expect(indexOf(bytes, "Planted")).toBe(-1);
    expect(indexOf(bytes, "uuid")).toBe(-1);
    for (const kept of ["avcC", "pasp"]) {
      const at = indexOf(before, kept) - 4;
      const size = new DataView(before.buffer).getUint32(at);
      expect(bytes.subarray(at, at + size), kept).toEqual(before.subarray(at, at + size));
    }
  });

  it("accepts a sample entry ending in a zero terminator; refuses one ending in anything else", () => {
    expect(inspectClip(clip({ tracks: [{ entryExtra: [zeros(4)] }] })).ok).toBe(true);
    expect(inspectClip(clip({ tracks: [{ entryExtra: [zeros(8)] }] })).ok).toBe(true);
    expectRefused(inspectClip(clip({ tracks: [{ entryExtra: [Uint8Array.of(0, 0, 0, 1)] }] })), "malformed");
    expectRefused(inspectClip(clip({ tracks: [{ entryExtra: [concat(zeros(8), latin1("junk"))] }] })), "malformed");
    // A child that runs past the entry.
    expectRefused(inspectClip(clip({ tracks: [{ entryExtra: [concat(u32(64), latin1("colr"))] }] })), "malformed");
  });

  it("leaves a refused clip untouched", () => {
    const bytes = clip({ tracks: [{}, { handler: "soun" }], topExtra: [box("udta", latin1("+37.8136"))] });
    const before = bytes.slice();
    expectRefused(sanitiseClip(bytes), "audio");
    expect(bytes).toEqual(before);
  });
});

/**
 * Real files from ffmpeg 6.1 (libx264 / libx265 / aac), made from its own
 * synthetic test pattern (testsrc2, 160 × 90, 10 fps, 1 s), so there are no
 * rights in them:
 *
 *   V="-f lavfi -i testsrc2=size=160x90:rate=10:duration=1"
 *   X264="-c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p"
 *   ffmpeg $V $X264 -metadata location="+37.8136+144.9631/" -metadata title="Planted title" h264.mp4
 *   ffmpeg $V $X264 -metadata location="+37.8136+144.9631/" \
 *     -metadata "com.apple.quicktime.make=PlantedMake" -movflags use_metadata_tags h264.mov
 *   ffmpeg $V -c:v libx265 -preset fast -crf 40 -pix_fmt yuv420p -tag:v hvc1 hevc.mp4
 *   ffmpeg $V -f lavfi -i sine=frequency=440:duration=1 $X264 -c:a aac -b:a 16k -shortest h264-aac.mp4
 *   ffmpeg $V $X264 -movflags frag_keyframe+empty_moov fragmented.mp4
 *
 * The sanitised h264 files were also checked by hand to decode to the same
 * frames as the originals (ffmpeg -f framemd5), with ffprobe showing no
 * location, title or make left.
 */
describe("real files", () => {
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "fixtures/clips", name)));

  it("accepts H.264 in MP4 and QuickTime, and strips the location and tags", () => {
    for (const [name, brand] of [
      ["h264.mp4", "isom"],
      ["h264.mov", "qt  "],
    ] as const) {
      const bytes = fixture(name);
      const length = bytes.length;
      const before = bytes.slice();
      expect(sanitiseClip(bytes), name).toEqual({
        ok: true,
        info: { durationMs: 1000, width: 160, height: 90, codedWidth: 160, codedHeight: 90, codec: "avc1", majorBrand: brand },
      });
      expect(bytes.length).toBe(length);
      for (const gone of ["Planted", "+37.8136", "©xyz", "udta", "VideoHandler"]) {
        expect(indexOf(bytes, gone), `${name} ${gone}`).toBe(-1);
      }
      // The mdat is byte for byte the same.
      const mdatAt = indexOf(before, "mdat") - 4;
      const mdatSize = new DataView(before.buffer).getUint32(mdatAt);
      expect(bytes.subarray(mdatAt, mdatAt + mdatSize)).toEqual(before.subarray(mdatAt, mdatAt + mdatSize));
    }
    // The QuickTime file had the location and make in plain text before, and both ffmpeg's handler name.
    expect(indexOf(fixture("h264.mov"), "PlantedMake")).toBeGreaterThan(0);
    for (const name of ["h264.mp4", "h264.mov"]) expect(indexOf(fixture(name), "VideoHandler"), name).toBeGreaterThan(0);
    expect(indexOf(fixture("h264.mov"), "+37.8136")).toBeGreaterThan(0);
  });

  it("refuses HEVC, sound and fragmented MP4", () => {
    expectRefused(inspectClip(fixture("hevc.mp4")), "hevc");
    expectRefused(inspectClip(fixture("h264-aac.mp4")), "audio");
    expectRefused(inspectClip(fixture("fragmented.mp4")), "fragmented");
  });
});
