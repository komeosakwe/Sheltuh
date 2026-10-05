/**
 * Error type every handler can throw to short-circuit to a specific HTTP
 * response (see lib/server/route.ts), plus JSON response helpers.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);

/**
 * For responses about or for the signed-in caller: never stored by a browser,
 * CDN or proxy cache, so one member's data can't be served to another.
 */
export const PRIVATE_NO_STORE = { "cache-control": "private, no-store" } as const;

export const okPrivate = (body: unknown) => Response.json(body, { status: 200, headers: PRIVATE_NO_STORE });
export const createdPrivate = (body: unknown) => Response.json(body, { status: 201, headers: PRIVATE_NO_STORE });
export const noContentPrivate = () => new Response(null, { status: 204, headers: PRIVATE_NO_STORE });

/** An error response: never cached either, since it can be about the caller (e.g. a 404 for their conversation). */
export const errorJson = (status: number, body: unknown) => Response.json(body, { status, headers: PRIVATE_NO_STORE });

/**
 * The largest JSON body the API reads (bytes). Far above any real request (an
 * event with a 4000-character description is a few KB), and small enough that
 * nothing downstream ever sees an unbounded string.
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

const TOO_LARGE = "That request is too large.";

/** Reads the body as bytes, refusing (413) as soon as it passes `limit`, whatever Content-Length says. */
async function readCapped(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, TOO_LARGE);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, TOO_LARGE);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The request's JSON object, or {} if the body is missing, not JSON or not an
 * object. 413 if it's over MAX_JSON_BODY_BYTES.
 */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  let text: string;
  try {
    text = await readCapped(req, MAX_JSON_BODY_BYTES);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return {};
  }
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
