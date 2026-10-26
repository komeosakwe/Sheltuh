/**
 * Event clips' bytes in Supabase Storage (supabase/migrations/20261106000000_event_clips.sql:
 * the private `event-clips` bucket, which has no storage.objects policies, so
 * only this server reaches it).
 *
 * The only module that reads SUPABASE_CLIP_STORAGE_KEY: a dedicated Supabase
 * secret key (sb_secret_…), separately revocable, used for nothing else. It
 * is sent to Supabase only, never logged, and never in an error message.
 * Without it (or NEXT_PUBLIC_SUPABASE_URL), createClipStorage returns
 * undefined: the clip routes answer 503 and the rest of live mode is
 * unaffected.
 *
 * Talks to the Storage REST API with fetch (no dependency). Endpoints and
 * headers as @supabase/storage-js 2.117.2 sends them
 * (node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts):
 *   createSignedUploadUrl  POST   /object/upload/sign/{bucket}/{path}  {}            → {url}
 *   info                   GET    /object/info/{bucket}/{path}                       → {size, …}
 *   download               GET    /object/{bucket}/{path}                            → bytes
 *   upload                 POST   /object/{bucket}/{path}  raw body, x-upsert         → {Key}
 *   createSignedUrl        POST   /object/sign/{bucket}/{path}  {expiresIn}          → {signedURL}
 *   remove                 DELETE /object/{bucket}  {prefixes: [...]}                → [...]
 * with `apikey` and `Authorization: Bearer` set to the key (supabase-js's
 * fetchWithAuth does the same for Storage). Redirects are refused
 * (`redirect: "error"`), so the key never follows one to another origin.
 */

/** The bucket (event_clips migration). */
export const CLIP_BUCKET = "event-clips";

/**
 * How long a signed upload URL works: fixed by Supabase Storage (2 hours;
 * storage-js can't change it). Reported to the browser as `expiresAt`.
 */
export const SIGNED_UPLOAD_URL_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Per request: metadata calls, and the byte transfers (at most 10 MB each way, server to Supabase in the same region). */
const METADATA_TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 40_000;
/** Storage's remove takes a list; kept well under its limit. */
const REMOVE_BATCH = 100;

/** A Storage call failed (network, timeout, or an unexpected status). Its message never holds the key or a URL's token. */
export class ClipStorageError extends Error {
  constructor(
    readonly operation: string,
    readonly status?: number,
  ) {
    super(`Clip storage ${operation} failed${status === undefined ? "" : ` (HTTP ${status})`}.`);
    this.name = "ClipStorageError";
  }
}

export interface ClipStorage {
  /** A URL the browser can PUT one new object to (no overwrite), valid SIGNED_UPLOAD_URL_LIFETIME_MS. */
  createUploadUrl(path: string): Promise<{ url: string }>;
  /** The object's size in bytes, or null if there's no such object. */
  info(path: string): Promise<{ size: number } | null>;
  /** The object's bytes; "missing" if there's none, "too_large" as soon as more than `maxBytes` arrive. */
  download(path: string, maxBytes: number): Promise<Uint8Array | "missing" | "too_large">;
  /** Writes (or overwrites) an object. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** An absolute URL that reads the object for `expiresInSeconds`. */
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  /** Deletes objects; ones that don't exist are fine. */
  remove(paths: string[]): Promise<void>;
}

/** Each path segment percent-encoded (our paths are only [a-z0-9-./] anyway). */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Storage's "no such object": a 404, or (older Storage API versions) a 400
 * whose JSON body says statusCode "404" / error "not_found".
 */
async function isNotFound(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => undefined)) as { statusCode?: unknown; error?: unknown } | undefined;
  return String(body?.statusCode) === "404" || body?.error === "not_found" || body?.error === "Not found";
}

/** Reads a response body, stopping (and cancelling it) once it passes `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * The Storage client, or undefined when SUPABASE_CLIP_STORAGE_KEY or
 * NEXT_PUBLIC_SUPABASE_URL is unset. `fetchImpl` is for tests.
 */
export function createClipStorage(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): ClipStorage | undefined {
  const key = env.SUPABASE_CLIP_STORAGE_KEY?.trim();
  const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!key || !projectUrl) return undefined;
  let base: URL;
  try {
    base = new URL(`${projectUrl.replace(/\/+$/, "")}/storage/v1`);
  } catch {
    return undefined;
  }
  const root = base.href;
  const auth = { apikey: key, authorization: `Bearer ${key}` };
  const objectUrl = (prefix: string, path: string) => `${root}/${prefix}/${CLIP_BUCKET}/${encodePath(path)}`;

  async function call(operation: string, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await fetchImpl(url, {
        ...init,
        headers: { ...auth, ...init.headers },
        // Never follow a redirect: the headers carry the key.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // The cause (a network, redirect or timeout error) is dropped: it can quote the URL.
      throw new ClipStorageError(operation);
    }
  }

  /** `relative` (as Storage returns it, e.g. "/object/sign/…?token=…") as an absolute URL on the Storage origin. */
  function absolute(operation: string, relative: unknown): string {
    if (typeof relative !== "string" || !relative.startsWith("/object/")) throw new ClipStorageError(operation);
    const url = new URL(`${root}${relative}`);
    if (url.origin !== base.origin || !url.searchParams.get("token")) throw new ClipStorageError(operation);
    return url.href;
  }

  async function jsonOf(operation: string, res: Response): Promise<Record<string, unknown>> {
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ClipStorageError(operation, res.status);
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (!body || typeof body !== "object") throw new ClipStorageError(operation, res.status);
    return body as Record<string, unknown>;
  }

  return {
    async createUploadUrl(path) {
      const res = await call(
        "createUploadUrl",
        objectUrl("object/upload/sign", path),
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        METADATA_TIMEOUT_MS,
      );
      const body = await jsonOf("createUploadUrl", res);
      return { url: absolute("createUploadUrl", body.url) };
    },

    async info(path) {
      const res = await call("info", objectUrl("object/info", path), { method: "GET" }, METADATA_TIMEOUT_MS);
      if (await isNotFound(res)) return null;
      const body = await jsonOf("info", res);
      const metadata = body.metadata as { size?: unknown } | undefined;
      const size = typeof body.size === "number" ? body.size : metadata?.size;
      if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new ClipStorageError("info", res.status);
      return { size };
    },

    async download(path, maxBytes) {
      const res = await call("download", objectUrl("object", path), { method: "GET" }, TRANSFER_TIMEOUT_MS);
      if (await isNotFound(res)) return "missing";
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new ClipStorageError("download", res.status);
      }
      try {
        return (await readCapped(res, maxBytes)) ?? "too_large";
      } catch {
        throw new ClipStorageError("download", res.status);
      }
    },

    async upload(path, bytes, contentType) {
      const res = await call(
        "upload",
        objectUrl("object", path),
        {
          method: "POST",
          headers: { "content-type": contentType, "x-upsert": "true", "cache-control": "max-age=3600" },
          body: new Blob([new Uint8Array(bytes)], { type: contentType }),
        },
        TRANSFER_TIMEOUT_MS,
      );
      await jsonOf("upload", res);
    },

    async createSignedUrl(path, expiresInSeconds) {
      const res = await call(
        "createSignedUrl",
        objectUrl("object/sign", path),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: expiresInSeconds }),
        },
        METADATA_TIMEOUT_MS,
      );
      const body = await jsonOf("createSignedUrl", res);
      return absolute("createSignedUrl", body.signedURL ?? body.signedUrl);
    },

    async remove(paths) {
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const res = await call(
          "remove",
          `${root}/object/${CLIP_BUCKET}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prefixes: paths.slice(i, i + REMOVE_BATCH) }),
          },
          METADATA_TIMEOUT_MS,
        );
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new ClipStorageError("remove", res.status);
        }
        await res.body?.cancel().catch(() => {});
      }
    },
  };
}
