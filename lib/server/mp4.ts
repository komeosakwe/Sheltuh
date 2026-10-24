/**
 * Event clips (supabase/migrations/20261106000000_event_clips.sql): checks an
 * uploaded clip's bytes and neutralises its metadata, without a dependency
 * and without decoding any video.
 *
 * A clip must be an MP4 (ISO base media file; QuickTime-branded files with
 * the same structure too) holding exactly one H.264 (`avc1`/`avc3`) video
 * track and nothing else: no audio (owner decision: clips never have sound),
 * no timed metadata, timecode or text tracks (their samples can carry
 * location), at most MAX_CLIP_DURATION_MS long, at most MAX_CLIP_PIXELS a
 * frame, not fragmented, and at most MAX_CLIP_BYTES.
 *
 * The walk is bounded: every box's size is checked against its parent; only
 * the containers on one fixed path are entered (file, moov, trak, mdia,
 * minf, stbl, stsd: never `mdat` or anything unexpected), so it's never more
 * than seven levels deep however the boxes nest; and it reads at most
 * MAX_BOXES boxes in all. A hostile file costs at most a few thousand reads.
 *
 * sanitiseClip then rewrites, in place, every box that can hold personal
 * metadata (`udta`, `meta` and `uuid` wherever the walk goes; at the top
 * level and in `moov`, everything but the boxes needed to play) as a
 * same-size `free` box with its payload zeroed. Nothing moves, so the chunk
 * offsets into `mdat` stay valid and the file plays as before, without its
 * location (`©xyz`, Apple's ISO 6709 keys), device or XMP tags.
 *
 * Not checked (accepted limits): that the chunk offsets and sample tables
 * agree with `mdat` (a file that lies there just won't play), and the video
 * samples themselves (H.264 SEI user data is left as is).
 */

import {
  CLIP_MESSAGES,
  MAX_CLIP_BYTES,
  MAX_CLIP_DURATION_MS,
  MAX_CLIP_PIXELS,
  MAX_CLIP_SIDE,
} from "@/lib/clip-rules";

// The limits live in lib/clip-rules.ts (shared with the browser's pre-checks).
export { MAX_CLIP_BYTES, MAX_CLIP_DURATION_MS, MAX_CLIP_PIXELS, MAX_CLIP_SIDE };
/** How many boxes the walk reads in all. A phone's clip has a few dozen. */
export const MAX_BOXES = 1000;

/** Brands (ftyp's major or a compatible one) of files with the structure we accept. */
const BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "qt  "]);

/** Boxes that only fragmented MP4 (streaming segments) has. */
const FRAGMENTED = new Set(["moof", "mfra", "mvex", "sidx", "ssix", "styp", "prft", "emsg"]);

/** Boxes rewritten as `free` wherever the walk meets them: they can hold location, device or XMP tags. */
const METADATA = new Set(["udta", "meta", "uuid"]);

/** The only top-level boxes kept; anything else (bar fragments, refused) is neutralised. */
const KEEP_TOP = new Set(["ftyp", "moov", "mdat"]);
/** The only `moov` children kept; anything else (bar mvex, refused) is neutralised. */
const KEEP_MOOV = new Set(["mvhd", "trak", "iods"]);

/** Padding: its payload is zeroed, so nothing can hide in it. */
const PADDING = new Set(["free", "skip", "wide"]);

const HEVC = new Set(["hvc1", "hev1", "dvh1", "dvhe"]);
const H264 = new Set(["avc1", "avc3"]);

/** Why a clip was refused. */
export type ClipProblem =
  | "too_large"
  | "not_mp4"
  | "webm"
  | "malformed"
  | "too_complex"
  | "fragmented"
  | "no_video"
  | "hevc"
  | "codec"
  | "audio"
  | "extra_track"
  | "no_duration"
  | "too_long"
  | "too_many_pixels";

/** What a refused clip's message can quote. */
export interface ClipProblemDetails {
  /** The clip's length (too_long). */
  durationMs?: number;
  /** The file's size (too_large). */
  sizeBytes?: number;
}

/**
 * What the organiser is told for a problem (the API's fieldErrors.clip): the
 * exact strings of docs/design/event-clips.md §5.4 (lib/clip-rules.ts).
 */
export function clipProblemMessage(problem: ClipProblem, details: ClipProblemDetails = {}): string {
  switch (problem) {
    case "too_large":
      return CLIP_MESSAGES.tooLarge(details.sizeBytes ?? MAX_CLIP_BYTES + 1);
    case "too_long":
      return CLIP_MESSAGES.tooLong(details.durationMs ?? MAX_CLIP_DURATION_MS + 1);
    case "not_mp4":
    case "webm":
      return CLIP_MESSAGES.notMp4;
    case "hevc":
      return CLIP_MESSAGES.hevc;
    case "audio":
      return CLIP_MESSAGES.audio;
    case "too_many_pixels":
      return CLIP_MESSAGES.tooManyPixels;
    case "malformed":
    case "too_complex":
    case "fragmented":
    case "no_video":
    case "codec":
    case "extra_track":
    case "no_duration":
      return CLIP_MESSAGES.unreadable;
  }
}

/** What a clip that passed holds. */
export interface ClipInfo {
  /** Rounded up, so at most MAX_CLIP_DURATION_MS. */
  durationMs: number;
  /**
   * Display size, as it's shown: the video track's tkhd size (or, when that's
   * zero, the coded size), turned a quarter if tkhd's matrix rotates it 90°
   * or 270° (a phone's portrait clip is often stored landscape and rotated).
   * Whole pixels; the event_clips width and height.
   */
  width: number;
  height: number;
  /** Encoded frame size (the sample entry), before any rotation. */
  codedWidth: number;
  codedHeight: number;
  codec: "avc1" | "avc3";
  majorBrand: string;
}

export type ClipCheck =
  | { ok: true; info: ClipInfo }
  /** `problems` lists every refusal found, most fundamental first; `problem` is the first. */
  | { ok: false; problem: ClipProblem; problems: ClipProblem[]; message: string };

interface Box {
  type: string;
  start: number;
  end: number;
  /** End of the size and type fields (8, or 16 with a 64-bit size): what neutralising keeps. */
  fieldsEnd: number;
  /** Start of the payload (after a uuid's 16-byte user type too). */
  payload: number;
}

/** A structural refusal: stops the walk at once. */
class Refusal {
  constructor(readonly problem: ClipProblem) {}
}

interface Track {
  handler: string | null;
  sampleEntry: string | null;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  /** tkhd's matrix turns the picture a quarter (90° or 270°). */
  quarterTurn: boolean;
  mediaDuration: Duration | null;
}

/** A duration in its own timescale (bigint: version 1 boxes carry 64-bit durations). */
interface Duration {
  value: bigint;
  timescale: number;
  /** All ones: "unknown" in both versions. */
  unknown: boolean;
}

interface Walk {
  bytes: Uint8Array;
  view: DataView;
  boxes: number;
  /** Ranges to rewrite as `free`. */
  neutralise: Box[];
  /** Padding whose payload is zeroed but whose type stays. */
  pad: Box[];
  majorBrand: string;
  movieDuration: Duration | null;
  tracks: Track[];
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/** The boxes tiling [from, to): each one's size checked against what's left. */
function readBoxes(walk: Walk, from: number, to: number, topLevel: boolean): Box[] {
  const { bytes, view } = walk;
  const boxes: Box[] = [];
  let at = from;
  while (at < to) {
    walk.boxes += 1;
    if (walk.boxes > MAX_BOXES) throw new Refusal("too_complex");
    if (to - at < 8) throw new Refusal("malformed");
    const size32 = view.getUint32(at);
    const type = fourcc(bytes, at + 4);
    let size: number;
    let fieldsEnd = at + 8;
    if (size32 === 1) {
      // 64-bit size. Anything from 4 GiB is far past what's left.
      if (to - at < 16) throw new Refusal("malformed");
      if (view.getUint32(at + 8) !== 0) throw new Refusal("malformed");
      size = view.getUint32(at + 12);
      fieldsEnd = at + 16;
      if (size < 16) throw new Refusal("malformed");
    } else if (size32 === 0) {
      // "To the end of the file": only for the media data, at the top level
      // (so it's necessarily the last box).
      if (!topLevel || type !== "mdat") throw new Refusal("malformed");
      size = to - at;
    } else {
      if (size32 < 8) throw new Refusal("malformed");
      size = size32;
    }
    const payload = type === "uuid" ? fieldsEnd + 16 : fieldsEnd;
    if (size > to - at || payload > at + size) throw new Refusal("malformed");
    boxes.push({ type, start: at, end: at + size, fieldsEnd, payload });
    at += size;
  }
  return boxes;
}

/** The single child of `type` (malformed if there are several), or null. */
function single(boxes: Box[], type: string): Box | null {
  const found = boxes.filter((b) => b.type === type);
  if (found.length > 1) throw new Refusal("malformed");
  return found[0] ?? null;
}

function required(boxes: Box[], type: string): Box {
  const box = single(boxes, type);
  if (!box) throw new Refusal("malformed");
  return box;
}

/** Queues the boxes that can hold metadata for neutralising, and padding for zeroing. */
function scrubChildren(walk: Walk, boxes: Box[], keep?: Set<string>) {
  for (const box of boxes) {
    if (METADATA.has(box.type) || (keep && !keep.has(box.type) && !PADDING.has(box.type))) {
      walk.neutralise.push(box);
    } else if (PADDING.has(box.type)) {
      walk.pad.push(box);
    }
  }
}

// BigInt() calls, not literals: the project targets ES2017.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const THOUSAND = BigInt(1000);
const ALL_ONES_64 = BigInt("0xffffffffffffffff");

/** mvhd / mdhd: a full box whose version picks 32- or 64-bit times. */
function readDuration(walk: Walk, box: Box): Duration {
  const { view } = walk;
  const p = box.payload;
  const version = walk.bytes[p];
  if (version === 0) {
    if (box.end - p < 20) throw new Refusal("malformed");
    const value = view.getUint32(p + 16);
    return { timescale: view.getUint32(p + 12), value: BigInt(value), unknown: value === 0xffffffff };
  }
  if (version === 1) {
    if (box.end - p < 32) throw new Refusal("malformed");
    const value = view.getBigUint64(p + 24);
    return { timescale: view.getUint32(p + 20), value, unknown: value === ALL_ONES_64 };
  }
  throw new Refusal("malformed");
}

/**
 * tkhd's width and height (16.16 fixed point), rounded up to whole pixels,
 * and whether its matrix turns the picture a quarter. The matrix (nine
 * 32-bit values, just before the width) is {a, b, u, c, d, v, x, y, w}; a
 * 90° or 270° turn has a = d = 0 and b, c non-zero.
 */
function readDisplaySize(walk: Walk, box: Box): { width: number; height: number; quarterTurn: boolean } {
  const p = box.payload;
  const version = walk.bytes[p];
  const offset = version === 0 ? 76 : version === 1 ? 88 : -1;
  if (offset < 0) throw new Refusal("malformed");
  if (box.end - p < offset + 8) throw new Refusal("malformed");
  const fixed = (value: number) => Math.ceil(value / 65536);
  const matrix = offset - 36;
  const a = walk.view.getInt32(p + matrix);
  const b = walk.view.getInt32(p + matrix + 4);
  const c = walk.view.getInt32(p + matrix + 12);
  const d = walk.view.getInt32(p + matrix + 16);
  return {
    width: fixed(walk.view.getUint32(p + offset)),
    height: fixed(walk.view.getUint32(p + offset + 4)),
    quarterTurn: a === 0 && d === 0 && b !== 0 && c !== 0,
  };
}

function readTrack(walk: Walk, trak: Box): Track {
  const track: Track = {
    handler: null,
    sampleEntry: null,
    codedWidth: 0,
    codedHeight: 0,
    displayWidth: 0,
    displayHeight: 0,
    quarterTurn: false,
    mediaDuration: null,
  };
  const trakChildren = readBoxes(walk, trak.payload, trak.end, false);
  scrubChildren(walk, trakChildren);
  const display = readDisplaySize(walk, required(trakChildren, "tkhd"));
  track.displayWidth = display.width;
  track.displayHeight = display.height;
  track.quarterTurn = display.quarterTurn;

  const mdia = required(trakChildren, "mdia");
  const mdiaChildren = readBoxes(walk, mdia.payload, mdia.end, false);
  scrubChildren(walk, mdiaChildren);
  track.mediaDuration = readDuration(walk, required(mdiaChildren, "mdhd"));

  // The media handler: version/flags, pre_defined (QuickTime's component
  // type), then the handler type ('vide', 'soun', 'meta', 'tmcd', 'text'…).
  const hdlr = required(mdiaChildren, "hdlr");
  if (hdlr.end - hdlr.payload < 12) throw new Refusal("malformed");
  track.handler = fourcc(walk.bytes, hdlr.payload + 8);
  if (track.handler !== "vide") return track;

  const minf = required(mdiaChildren, "minf");
  const minfChildren = readBoxes(walk, minf.payload, minf.end, false);
  scrubChildren(walk, minfChildren);
  const stbl = required(minfChildren, "stbl");
  const stblChildren = readBoxes(walk, stbl.payload, stbl.end, false);
  scrubChildren(walk, stblChildren);

  // stsd: version/flags, entry count, then the sample entries (boxes). One
  // entry only: several could mix codecs.
  const stsd = required(stblChildren, "stsd");
  if (stsd.end - stsd.payload < 8) throw new Refusal("malformed");
  if (walk.view.getUint32(stsd.payload + 4) !== 1) throw new Refusal("too_complex");
  const entries = readBoxes(walk, stsd.payload + 8, stsd.end, false);
  if (entries.length !== 1) throw new Refusal("malformed");
  const entry = entries[0];
  track.sampleEntry = entry.type;
  if (H264.has(entry.type)) {
    // VisualSampleEntry: reserved (6), data_reference_index (2), pre_defined
    // and reserved (16), then width and height (16 bits each); 78 bytes in all.
    if (entry.end - entry.payload < 78) throw new Refusal("malformed");
    track.codedWidth = walk.view.getUint16(entry.payload + 24);
    track.codedHeight = walk.view.getUint16(entry.payload + 26);
  }
  return track;
}

function walkFile(bytes: Uint8Array): Walk {
  const walk: Walk = {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    boxes: 0,
    neutralise: [],
    pad: [],
    majorBrand: "",
    movieDuration: null,
    tracks: [],
  };

  const top = readBoxes(walk, 0, bytes.length, true);
  if (top.some((b) => FRAGMENTED.has(b.type))) throw new Refusal("fragmented");

  // ftyp first, once: major brand, minor version, compatible brands.
  const ftyp = top[0];
  if (ftyp.type !== "ftyp" || top.filter((b) => b.type === "ftyp").length !== 1) throw new Refusal("not_mp4");
  const ftypLength = ftyp.end - ftyp.payload;
  if (ftypLength < 8 || ftypLength % 4 !== 0) throw new Refusal("malformed");
  walk.majorBrand = fourcc(bytes, ftyp.payload);
  const brands = [walk.majorBrand];
  for (let at = ftyp.payload + 8; at < ftyp.end; at += 4) brands.push(fourcc(bytes, at));
  if (!brands.some((brand) => BRANDS.has(brand))) throw new Refusal("not_mp4");

  if (!top.some((b) => b.type === "mdat")) throw new Refusal("malformed");
  scrubChildren(walk, top, KEEP_TOP);

  const moov = required(top, "moov");
  const moovChildren = readBoxes(walk, moov.payload, moov.end, false);
  if (moovChildren.some((b) => FRAGMENTED.has(b.type))) throw new Refusal("fragmented");
  scrubChildren(walk, moovChildren, KEEP_MOOV);
  walk.movieDuration = readDuration(walk, required(moovChildren, "mvhd"));
  for (const trak of moovChildren.filter((b) => b.type === "trak")) walk.tracks.push(readTrack(walk, trak));
  return walk;
}

/** A day: any longer is reported as a day (it's refused either way, and a 64-bit duration can be absurd). */
const LONGEST_REPORTED_MS = BigInt(24 * 60 * 60 * 1000);

/**
 * `duration`'s length in ms (rounded up), or "no_duration" for none, zero or
 * unknown; `tooLong` when it's over MAX_CLIP_DURATION_MS.
 */
function durationMs(duration: Duration | null): { ms: number; tooLong: boolean } | "no_duration" {
  if (!duration || duration.unknown || duration.timescale === 0 || duration.value === ZERO) return "no_duration";
  const scale = BigInt(duration.timescale);
  let ms = (duration.value * THOUSAND + scale - ONE) / scale;
  if (ms > LONGEST_REPORTED_MS) ms = LONGEST_REPORTED_MS;
  return { ms: Number(ms), tooLong: duration.value * THOUSAND > BigInt(MAX_CLIP_DURATION_MS) * scale };
}

function check(walk: Walk): ClipCheck {
  const problems: ClipProblem[] = [];
  const add = (problem: ClipProblem) => {
    if (!problems.includes(problem)) problems.push(problem);
  };

  const videos = walk.tracks.filter((t) => t.handler === "vide");
  if (videos.length === 0) add("no_video");
  for (const video of videos) {
    const entry = video.sampleEntry ?? "";
    if (HEVC.has(entry)) add("hevc");
    else if (!H264.has(entry)) add("codec");
  }
  if (walk.tracks.some((t) => t.handler === "soun")) add("audio");
  if (videos.length > 1 || walk.tracks.some((t) => t.handler !== "vide" && t.handler !== "soun")) add("extra_track");

  // The movie and every track: none missing, none over the limit.
  let longest = 0;
  for (const duration of [walk.movieDuration, ...walk.tracks.map((t) => t.mediaDuration)]) {
    const length = durationMs(duration);
    if (length === "no_duration") {
      add("no_duration");
      continue;
    }
    longest = Math.max(longest, length.ms);
    if (length.tooLong) add("too_long");
  }

  const video = videos[0];
  if (
    video &&
    H264.has(video.sampleEntry ?? "") &&
    (video.codedWidth === 0 ||
      video.codedHeight === 0 ||
      video.codedWidth * video.codedHeight > MAX_CLIP_PIXELS ||
      video.displayWidth * video.displayHeight > MAX_CLIP_PIXELS ||
      Math.max(video.codedWidth, video.codedHeight, video.displayWidth, video.displayHeight) > MAX_CLIP_SIDE)
  ) {
    add(video.codedWidth === 0 || video.codedHeight === 0 ? "malformed" : "too_many_pixels");
  }

  if (problems.length > 0) return refused(problems, { durationMs: longest });
  // tkhd's size, or the coded size when tkhd has none; then the matrix's turn.
  const shownWidth = video.displayWidth && video.displayHeight ? video.displayWidth : video.codedWidth;
  const shownHeight = video.displayWidth && video.displayHeight ? video.displayHeight : video.codedHeight;
  return {
    ok: true,
    info: {
      durationMs: longest,
      width: video.quarterTurn ? shownHeight : shownWidth,
      height: video.quarterTurn ? shownWidth : shownHeight,
      codedWidth: video.codedWidth,
      codedHeight: video.codedHeight,
      codec: video.sampleEntry as "avc1" | "avc3",
      majorBrand: walk.majorBrand,
    },
  };
}

function refused(problems: ClipProblem[], details: ClipProblemDetails = {}): ClipCheck {
  return {
    ok: false,
    problem: problems[0],
    problems,
    // Each distinct message once (several problems share "We couldn't read this clip").
    message: [...new Set(problems.map((p) => clipProblemMessage(p, details)))].join(" "),
  };
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

function inspect(bytes: Uint8Array): { check: ClipCheck; walk?: Walk } {
  if (bytes.length > MAX_CLIP_BYTES) return { check: refused(["too_large"], { sizeBytes: bytes.length }) };
  if (bytes.length >= 4 && EBML_MAGIC.every((b, i) => bytes[i] === b)) return { check: refused(["webm"]) };
  if (bytes.length < 8 || fourcc(bytes, 4) !== "ftyp") return { check: refused(["not_mp4"]) };
  let walk: Walk;
  try {
    walk = walkFile(bytes);
  } catch (err) {
    if (err instanceof Refusal) return { check: refused([err.problem]) };
    throw err;
  }
  return { check: check(walk), walk };
}

/** Checks a clip's bytes (read-only). */
export function inspectClip(bytes: Uint8Array): ClipCheck {
  return inspect(bytes).check;
}

/**
 * Checks a clip and, if it passes, neutralises its metadata in place (see the
 * header): `bytes` keeps its length and every byte of `mdat`. A refused clip
 * is left untouched.
 */
export function sanitiseClip(bytes: Uint8Array): ClipCheck {
  const { check: result, walk } = inspect(bytes);
  if (!result.ok || !walk) return result;
  const FREE = [0x66, 0x72, 0x65, 0x65]; // "free"
  for (const box of walk.neutralise) {
    bytes.set(FREE, box.start + 4);
    bytes.fill(0, box.fieldsEnd, box.end);
  }
  for (const box of walk.pad) bytes.fill(0, box.fieldsEnd, box.end);
  return result;
}
