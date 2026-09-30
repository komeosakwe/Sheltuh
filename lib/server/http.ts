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

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
