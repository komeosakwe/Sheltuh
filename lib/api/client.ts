export const API_URL = process.env.NEXT_PUBLIC_API_URL;
export const isApiConfigured = Boolean(API_URL);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Cognito ID token. Omit for the two public read routes. */
  token?: string;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (!API_URL) {
    throw new Error("The live API is not configured in this environment (NEXT_PUBLIC_API_URL is unset).");
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const message = (data && typeof data.error === "string" && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data?.fieldErrors);
  }

  return data as T;
}
