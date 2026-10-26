import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * The live API is this app's own route handlers (app/api/**), backed by
 * Supabase. Without Supabase configured the app runs in demo mode on local
 * sample data and never calls it.
 */
export const isApiConfigured = isSupabaseConfigured;
const API_BASE = "/api";

/**
 * Resolves a currently-valid Supabase access token, refreshing it first if
 * needed (see lib/auth/AuthContext.tsx's `getAccessToken`). Every
 * authenticated API wrapper takes one of these instead of a plain token
 * string so it always fetches a fresh token right before the request,
 * rather than trusting a value the caller captured earlier and that may
 * have since expired.
 */
export type GetToken = () => Promise<string>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
    /** The whole error body, for routes that send more than `error` and `fieldErrors` (e.g. SeatErrorDetails). */
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A Blob is sent as-is (e.g. an image upload); anything else as JSON. */
  body?: unknown;
  /** Supabase access token. Omit for the public routes. */
  token?: string;
  /**
   * Cancels the request. Once it's aborted, the abort error is thrown (an
   * AbortError DOMException, or the signal's reason), never an ApiError, even
   * if the response had already arrived.
   */
  signal?: AbortSignal;
  /** Extra request headers (e.g. `idempotency-key`). Can't replace content-type or authorization. */
  headers?: Record<string, string>;
}

/**
 * How long a request may take before it fails with "took too long", so a
 * stalled server or database shows the page's error state instead of a
 * spinner that never ends. Uploads send a whole file, so they get longer.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
const TIMED_OUT_MESSAGE = "The server took too long to respond. Try again.";

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (!isApiConfigured) {
    throw new Error("The live API is not configured in this environment (Supabase is unset).");
  }

  // One signal for the request: the caller's, plus the timeout. Built by
  // hand rather than with AbortSignal.any, which older Safari lacks.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options.body instanceof Blob ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
  );
  const callerSignal = options.signal;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardAbort();
  else callerSignal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    return await send<T>(path, options, controller.signal, () => timedOut);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

async function send<T>(
  path: string,
  options: FetchOptions,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...options.headers,
        "content-type": options.body instanceof Blob ? options.body.type : "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof Blob
            ? options.body
            : JSON.stringify(options.body),
      signal,
      // The page's address can hold a visitor's suburb (/search?near=…): send
      // only the origin as a Referer. No handler reads Referer.
      referrerPolicy: "strict-origin",
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    if (timedOut()) throw new ApiError(0, TIMED_OUT_MESSAGE);
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => undefined) : undefined;
  // Aborted while the body was being read: never hand back a missing body as a result.
  options.signal?.throwIfAborted();
  if (timedOut()) throw new ApiError(0, TIMED_OUT_MESSAGE);

  if (!res.ok) {
    const message = (data && typeof data.error === "string" && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data?.fieldErrors, data && typeof data === "object" ? data : undefined);
  }

  return data as T;
}
