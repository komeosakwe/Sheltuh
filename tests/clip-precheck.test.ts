// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clipContentType, precheckClip, readClipMetadata } from "@/lib/clip-precheck";
import { CLIP_MESSAGES, MAX_CLIP_BYTES } from "@/lib/clip-rules";

/**
 * The browser's clip checks (docs/design/event-clips.md §5.4): type, size,
 * length and pixels, with the server's exact messages, and a file the
 * browser can't read left to the server.
 */

function file(name: string, type: string, size = 1000) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("clipContentType", () => {
  it("declares MP4 or MOV from the type, or the name where there's none", () => {
    expect(clipContentType(file("a.mp4", "video/mp4"))).toBe("video/mp4");
    expect(clipContentType(file("a.m4v", "video/x-m4v"))).toBe("video/mp4");
    expect(clipContentType(file("a.mov", "video/quicktime"))).toBe("video/quicktime");
    expect(clipContentType(file("IMG_1.MOV", ""))).toBe("video/quicktime");
    expect(clipContentType(file("clip.mp4", "application/octet-stream"))).toBe("video/mp4");
    expect(clipContentType(file("clip.webm", "video/webm"))).toBeNull();
    expect(clipContentType(file("clip.mp4", "image/png"))).toBeNull();
    expect(clipContentType(file("clip", ""))).toBeNull();
  });
});

describe("precheckClip", () => {
  const ok = async () => ({ durationMs: 15_000, width: 1920, height: 1080 });

  it("passes a 15 s 1080p MP4 (and 15.5 s of encoder rounding)", async () => {
    expect(await precheckClip(file("a.mp4", "video/mp4"), ok)).toEqual({
      ok: true,
      contentType: "video/mp4",
      metadata: { durationMs: 15_000, width: 1920, height: 1080 },
    });
    expect((await precheckClip(file("a.mp4", "video/mp4"), async () => ({ durationMs: 15_500, width: 1080, height: 1920 }))).ok).toBe(true);
  });

  it("refuses with the server's words, without reading a file it can already refuse", async () => {
    const read = vi.fn(ok);
    expect(await precheckClip(file("a.webm", "video/webm"), read)).toEqual({ ok: false, message: CLIP_MESSAGES.notMp4 });
    expect(await precheckClip(file("a.mp4", "video/mp4", MAX_CLIP_BYTES + 1), read)).toEqual({
      ok: false,
      message: CLIP_MESSAGES.tooLarge(MAX_CLIP_BYTES + 1),
    });
    expect(read).not.toHaveBeenCalled();
    expect(await precheckClip(file("a.mp4", "video/mp4"), async () => ({ durationMs: 15_501, width: 1, height: 1 }))).toEqual({
      ok: false,
      message: CLIP_MESSAGES.tooLong(15_501),
    });
    expect(await precheckClip(file("a.mp4", "video/mp4"), async () => ({ durationMs: 5000, width: 2560, height: 1440 }))).toEqual({
      ok: false,
      message: CLIP_MESSAGES.tooManyPixels,
    });
    expect(await precheckClip(file("a.mp4", "video/mp4"), async () => ({ durationMs: 5000, width: 5000, height: 2 }))).toEqual({
      ok: false,
      message: CLIP_MESSAGES.tooManyPixels,
    });
  });

  it("leaves what the browser can't read (no decoder, no duration) to the server", async () => {
    expect(await precheckClip(file("a.mov", "video/quicktime"), async () => null)).toEqual({
      ok: true,
      contentType: "video/quicktime",
      metadata: null,
    });
    expect((await precheckClip(file("a.mp4", "video/mp4"), async () => ({ durationMs: null, width: 720, height: 1280 }))).ok).toBe(true);
  });
});

describe("readClipMetadata", () => {
  function stubVideo(onSrc: (video: HTMLVideoElement) => void) {
    URL.createObjectURL = vi.fn(() => "blob:clip");
    URL.revokeObjectURL = vi.fn();
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = create(tag);
      if (tag === "video") {
        Object.defineProperty(el, "src", { configurable: true, set: () => queueMicrotask(() => onSrc(el as HTMLVideoElement)) });
      }
      return el;
    }) as typeof document.createElement);
  }

  it("reads the length and size from a hidden video, then lets the file go", async () => {
    stubVideo((video) => {
      Object.defineProperty(video, "duration", { value: 12.34 });
      Object.defineProperty(video, "videoWidth", { value: 1080 });
      Object.defineProperty(video, "videoHeight", { value: 1920 });
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(await readClipMetadata(new Blob(["x"]))).toEqual({ durationMs: 12_340, width: 1080, height: 1920 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });

  it("is null when the browser can't read it, or takes too long", async () => {
    stubVideo((video) => video.dispatchEvent(new Event("error")));
    expect(await readClipMetadata(new Blob(["x"]))).toBeNull();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    stubVideo(() => {});
    const pending = readClipMetadata(new Blob(["x"]), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });
});
