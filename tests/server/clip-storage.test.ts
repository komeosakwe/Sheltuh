import { describe, expect, it, vi } from "vitest";
import { ClipStorageError, createClipStorage, type ClipStorage } from "@/lib/server/clip-storage";

/**
 * lib/server/clip-storage.ts against a stubbed fetch: the Storage REST calls
 * as @supabase/storage-js 2.117.2 makes them. Real Supabase Storage isn't
 * reached here.
 */

const KEY = "sb_secret_test_not_real";
const ENV = { SUPABASE_CLIP_STORAGE_KEY: KEY, NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.test/" };
const ROOT = "https://ref.supabase.test/storage/v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init ?? {}));
  const storage = createClipStorage(ENV, fetch as unknown as typeof globalThis.fetch) as ClipStorage;
  return { storage, fetch };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe("createClipStorage", () => {
  it("is undefined without the key or the project URL", () => {
    expect(createClipStorage({})).toBeUndefined();
    expect(createClipStorage({ NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL })).toBeUndefined();
    expect(createClipStorage({ SUPABASE_CLIP_STORAGE_KEY: KEY })).toBeUndefined();
    expect(createClipStorage({ ...ENV, SUPABASE_CLIP_STORAGE_KEY: "  " })).toBeUndefined();
    expect(createClipStorage(ENV)).toBeDefined();
  });

  it("signs an upload URL: POST /object/upload/sign/{bucket}/{path}, with the key as apikey and bearer", async () => {
    const { storage, fetch } = client(() => json({ url: "/object/upload/sign/event-clips/uploads/e/u/x.mp4?token=abc" }));
    expect(await storage.createUploadUrl("uploads/e/u/x.mp4")).toEqual({
      url: `${ROOT}/object/upload/sign/event-clips/uploads/e/u/x.mp4?token=abc`,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${ROOT}/object/upload/sign/event-clips/uploads/e/u/x.mp4`);
    expect(init?.method).toBe("POST");
    expect(headersOf(init!)).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}` });
    // Not overwriting: no x-upsert on the signed upload URL.
    expect(headersOf(init!)["x-upsert"]).toBeUndefined();
  });

  it("never follows a redirect (the key is in the headers): every call is redirect: error", async () => {
    const { storage, fetch } = client((url) =>
      url.includes("/object/info/")
        ? json({ size: 1 })
        : url.includes("/object/sign/")
          ? json({ signedURL: "/object/sign/event-clips/a.mp4?token=t" })
          : url.includes("/object/upload/sign/")
            ? json({ url: "/object/upload/sign/event-clips/a.mp4?token=t" })
            : json([]), // remove, download, upload
    );
    await storage.createUploadUrl("a.mp4");
    await storage.info("a.mp4");
    await storage.createSignedUrl("a.mp4", 60);
    await storage.remove(["a.mp4"]);
    await storage.download("a.mp4", 1024);
    await storage.upload("a.mp4", new Uint8Array([1]), "video/mp4");
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "POST", "DELETE", "GET", "POST"]);
    for (const [, init] of fetch.mock.calls) expect(init?.redirect).toBe("error");
  });

  it("refuses a signed URL that isn't relative to Storage, or has no token", async () => {
    for (const url of ["https://evil.example/x?token=a", "//evil.example/x?token=a", "/object/upload/sign/x", 42]) {
      const { storage } = client(() => json({ url }));
      await expect(storage.createUploadUrl("uploads/x.mp4")).rejects.toBeInstanceOf(ClipStorageError);
    }
  });

  it("reads an object's size, and null when there's none (404, or an older API's 400 not_found)", async () => {
    let answer: Response = json({ name: "x", size: 1234 });
    const { storage, fetch } = client(() => answer);
    expect(await storage.info("uploads/x.mp4")).toEqual({ size: 1234 });
    expect(fetch.mock.calls[0][0]).toBe(`${ROOT}/object/info/event-clips/uploads/x.mp4`);
    answer = json({ metadata: { size: 99 } });
    expect(await storage.info("uploads/x.mp4")).toEqual({ size: 99 });
    answer = json({ statusCode: "404", error: "not_found", message: "Object not found" }, 404);
    expect(await storage.info("uploads/x.mp4")).toBeNull();
    answer = json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
    expect(await storage.info("uploads/x.mp4")).toBeNull();
    answer = json({ error: "boom" }, 500);
    await expect(storage.info("uploads/x.mp4")).rejects.toMatchObject({ operation: "info", status: 500 });
  });

  it("downloads with a byte cap, by Content-Length or as the bytes arrive", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    let answer = () => new Response(bytes, { headers: { "content-length": "5" } });
    const { storage, fetch } = client(() => answer());
    expect(await storage.download("uploads/x.mp4", 5)).toEqual(bytes);
    expect(fetch.mock.calls[0][0]).toBe(`${ROOT}/object/event-clips/uploads/x.mp4`);
    expect(await storage.download("uploads/x.mp4", 4)).toBe("too_large");
    // No Content-Length: cut off as it streams.
    answer = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(3));
            controller.enqueue(new Uint8Array(3));
            controller.close();
          },
        }),
      );
    expect(await storage.download("uploads/x.mp4", 5)).toBe("too_large");
    answer = () => json({ statusCode: "404", error: "not_found" }, 404);
    expect(await storage.download("uploads/x.mp4", 5)).toBe("missing");
  });

  it("uploads with upsert, as video/mp4", async () => {
    const { storage, fetch } = client(() => json({ Key: "event-clips/clips/e/u.mp4" }));
    await storage.upload("clips/e/u.mp4", new Uint8Array([1, 2]), "video/mp4");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${ROOT}/object/event-clips/clips/e/u.mp4`);
    expect(init?.method).toBe("POST");
    expect(headersOf(init!)).toMatchObject({ "content-type": "video/mp4", "x-upsert": "true", apikey: KEY });
    expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it("signs a read URL for a time, and removes in batches", async () => {
    const { storage, fetch } = client((url) =>
      url.includes("/object/sign/") ? json({ signedURL: "/object/sign/event-clips/clips/e/u.mp4?token=read" }) : json([]),
    );
    expect(await storage.createSignedUrl("clips/e/u.mp4", 3600)).toBe(`${ROOT}/object/sign/event-clips/clips/e/u.mp4?token=read`);
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ expiresIn: 3600 });

    const paths = Array.from({ length: 150 }, (_, i) => `clips/e/${i}.mp4`);
    await storage.remove(paths);
    const removes = fetch.mock.calls.slice(1);
    expect(removes.map(([url, init]) => [url, init?.method])).toEqual([
      [`${ROOT}/object/event-clips`, "DELETE"],
      [`${ROOT}/object/event-clips`, "DELETE"],
    ]);
    expect(removes.flatMap(([, init]) => JSON.parse(init!.body as string).prefixes)).toEqual(paths);
    await storage.remove([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never puts the key or a token in an error", async () => {
    const { storage } = client(() => {
      throw new Error(`connect failed for ${ROOT}/object/sign?token=secret apikey=${KEY}`);
    });
    const err = await storage.createSignedUrl("clips/e/u.mp4", 60).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClipStorageError);
    expect((err as Error).message).toBe("Clip storage createSignedUrl failed.");
    expect(JSON.stringify(err)).not.toContain(KEY);
  });
});
