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
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (!isApiConfigured) {
    throw new Error("The live API is not configured in this environment (Supabase is unset).");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": options.body instanceof Blob ? options.body.type : "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof Blob
            ? options.body
            : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
      // The page's address can hold a visitor's suburb (/search?near=…): send
      // only the origin as a Referer. No handler reads Referer.
      referrerPolicy: "strict-origin",
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => undefined) : undefined;
  // Aborted while the body was being read: never hand back a missing body as a result.
  options.signal?.throwIfAborted();

  if (!res.ok) {
    const message = (data && typeof data.error === "string" && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data?.fieldErrors, data && typeof data === "object" ? data : undefined);
  }

  return data as T;
}
