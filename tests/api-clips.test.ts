import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/lib/api/public-events";
import { CLIP_MESSAGES, clipMegabytes, clipSeconds, MAX_CLIP_BYTES } from "@/lib/clip-rules";

// Live mode, with a Supabase project for the Storage upload.
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));

const clips = await import("@/lib/api/clips");
const { ApiError } = await import("@/lib/api/client");
const { adaptPublicEvent } = await import("@/lib/live/adapt");

const getToken = async () => "tok";

function stubFetch(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clip API calls", () => {
  it("the organiser's: upload URL, attach, delete and preview, with the token", async () => {
    const fetch = stubFetch({});
    await clips.requestClipUpload("evt-1", { sizeBytes: 1000, contentType: "video/mp4" }, getToken);
    await clips.attachClip("evt-1", { uploadId: "u-1", description: "Crowd.", rightsConfirmed: true }, getToken);
    await clips.deleteClip("evt-1", getToken);
    await clips.getClipPreview("evt-1", getToken);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body && JSON.parse(init.body)])).toEqual([
      ["/api/events/evt-1/clip/uploads", "POST", { sizeBytes: 1000, contentType: "video/mp4" }],
      ["/api/events/evt-1/clip", "PUT", { uploadId: "u-1", description: "Crowd.", rightsConfirmed: true }],
      ["/api/events/evt-1/clip", "DELETE", undefined],
      ["/api/events/evt-1/clip/preview", "GET", undefined],
    ]);
    for (const [, init] of fetch.mock.calls) expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("the admin's: under /admin, with an optional reason", async () => {
    const fetch = stubFetch({});
    await clips.adminRequestClipUpload("evt-1", { sizeBytes: 1000, contentType: "video/quicktime" }, getToken);
    await clips.adminAttachClip("evt-1", { uploadId: "u-1", description: "Crowd.", rightsConfirmed: true, reason: "Why" }, getToken);
    await clips.adminDeleteClip("evt-1", getToken, "Rights complaint.");
    await clips.adminDeleteClip("evt-1", getToken);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, init.body && JSON.parse(init.body)])).toEqual([
      ["/api/admin/events/evt-1/clip/uploads", "POST", { sizeBytes: 1000, contentType: "video/quicktime" }],
      ["/api/admin/events/evt-1/clip", "PUT", { uploadId: "u-1", description: "Crowd.", rightsConfirmed: true, reason: "Why" }],
      ["/api/admin/events/evt-1/clip", "DELETE", { reason: "Rights complaint." }],
      ["/api/admin/events/evt-1/clip", "DELETE", undefined],
    ]);
  });

  it("passes the server's field errors through", async () => {
    stubFetch({ error: CLIP_MESSAGES.uploadExpired, fieldErrors: { clip: CLIP_MESSAGES.uploadExpired } }, 410);
    const err = await clips.attachClip("evt-1", { uploadId: "u-1", description: "x", rightsConfirmed: true }, getToken).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 410, fieldErrors: { clip: CLIP_MESSAGES.uploadExpired } });
  });
});

/** A stand-in XMLHttpRequest that records what was sent and answers as told. */
class FakeXhr {
  static last: FakeXhr | undefined;
  static respond: (xhr: FakeXhr) => void = (xhr) => xhr.finish(200);
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.last = this;
    queueMicrotask(() => FakeXhr.respond(this));
  }
  abort() {
    this.onabort?.();
  }
  finish(status: number, text = "") {
    this.status = status;
    this.responseText = text;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    this.onload?.();
  }
}

describe("uploadClipToStorage", () => {
  const UPLOAD_URL = "https://project.supabase.test/storage/v1/object/upload/sign/event-clips/uploads/e/u/x.mp4?token=t";
  const file = new Blob([new Uint8Array(100)], { type: "video/mp4" });

  function stubXhr(respond: (xhr: FakeXhr) => void) {
    FakeXhr.last = undefined;
    FakeXhr.respond = respond;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  }

  it("PUTs the file to the signed URL as storage-js does, with progress", async () => {
    stubXhr((xhr) => xhr.finish(200, '{"Key":"event-clips/uploads/e/u/x.mp4"}'));
    const progress: number[] = [];
    await clips.uploadClipToStorage(UPLOAD_URL, file, { contentType: "video/mp4", onProgress: (f) => progress.push(f) });
    expect(FakeXhr.last).toMatchObject({
      method: "PUT",
      url: UPLOAD_URL,
      headers: {
        apikey: "sb_publishable_test",
        "content-type": "video/mp4",
        "x-upsert": "false",
        "cache-control": "max-age=3600",
      },
      body: file,
    });
    expect(progress).toEqual([0.5, 1]);
  });

  it("refuses a URL that isn't this project's Storage (nothing sent)", async () => {
    stubXhr((xhr) => xhr.finish(200));
    for (const url of ["https://evil.example/storage/v1/object/upload/sign/x?token=t", "not a url"]) {
      await expect(clips.uploadClipToStorage(url, file, { contentType: "video/mp4" })).rejects.toMatchObject({
        status: 0,
        fieldErrors: { clip: CLIP_MESSAGES.unavailable },
      });
    }
    expect(FakeXhr.last).toBeUndefined();
  });

  it("maps failures to the spec's messages", async () => {
    const cases: [(xhr: FakeXhr) => void, number, string][] = [
      [(xhr) => xhr.onerror?.(), 0, CLIP_MESSAGES.networkDrop],
      [(xhr) => xhr.finish(413), 413, CLIP_MESSAGES.tooLarge(file.size)],
      [(xhr) => xhr.finish(400, '{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}'), 410, CLIP_MESSAGES.uploadExpired],
      [(xhr) => xhr.finish(400, '{"statusCode":"415","error":"invalid_mime_type","message":"mime type video/webm is not supported"}'), 415, CLIP_MESSAGES.notMp4],
      [(xhr) => xhr.finish(500), 500, CLIP_MESSAGES.unavailable],
    ];
    for (const [respond, status, message] of cases) {
      stubXhr(respond);
      await expect(clips.uploadClipToStorage(UPLOAD_URL, file, { contentType: "video/mp4" })).rejects.toMatchObject({
        status,
        fieldErrors: { clip: message },
      });
    }
  });

  it("can be cancelled", async () => {
    stubXhr(() => {});
    const controller = new AbortController();
    const upload = clips.uploadClipToStorage(UPLOAD_URL, file, { contentType: "video/mp4", signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("clip rules", () => {
  it("shows sizes and lengths as people read them", () => {
    expect(clipMegabytes(12.3 * 1024 * 1024)).toBe("12.3");
    expect(clipMegabytes(MAX_CLIP_BYTES)).toBe("10");
    // Just over the cap never reads as the cap.
    expect(clipMegabytes(MAX_CLIP_BYTES + 1)).toBe("10.1");
    expect(clipSeconds(400)).toBe(1);
    expect(clipSeconds(12_400)).toBe(12);
    expect(clipSeconds(15_500)).toBe(16);
  });
});

describe("adaptPublicEvent: clip", () => {
  const base: PublicEvent = {
    organiserId: "org-1",
    eventId: "evt-1",
    slug: "neon-static",
    title: "Neon Static",
    description: "Four bands.",
    category: "live-music",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    startsAt: "2027-03-06T09:00:00.000Z",
    endsAt: "2027-03-06T12:30:00.000Z",
    organiserName: "Static Collective",
    ticketTypes: [],
  };

  it("carries the clip when there is one, and nothing otherwise", () => {
    const clip = { url: "/api/events/evt-1/clip?v=1700000000000", durationMs: 12_000, width: 1080, height: 1920, description: "Crowd." };
    expect(adaptPublicEvent({ ...base, clip }).clip).toEqual(clip);
    expect("clip" in adaptPublicEvent(base)).toBe(false);
  });
});
