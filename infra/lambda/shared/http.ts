import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function ok(body: unknown): APIGatewayProxyResultV2 {
  return json(200, body);
}

export function created(body: unknown): APIGatewayProxyResultV2 {
  return json(201, body);
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204, body: "" };
}

export function badRequest(message: string, fieldErrors?: Record<string, string>): APIGatewayProxyResultV2 {
  return json(400, { error: message, fieldErrors });
}

export function unauthorized(message = "Sign in required."): APIGatewayProxyResultV2 {
  return json(401, { error: message });
}

export function forbidden(message = "You don't have permission to do that."): APIGatewayProxyResultV2 {
  return json(403, { error: message });
}

export function notFound(message = "Not found."): APIGatewayProxyResultV2 {
  return json(404, { error: message });
}

export function conflict(message: string): APIGatewayProxyResultV2 {
  return json(409, { error: message });
}

export function serverError(message = "Something went wrong."): APIGatewayProxyResultV2 {
  return json(500, { error: message });
}

export function parseBody<T>(event: ApiEvent): T | undefined {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * A handler can throw one of these to short-circuit to a specific HTTP
 * response without every validation branch building its own ApiGatewayProxyResultV2.
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

export async function handle(fn: () => Promise<APIGatewayProxyResultV2>): Promise<APIGatewayProxyResultV2> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.statusCode, { error: err.message, fieldErrors: err.fieldErrors });
    }
    // Never log request bodies or claims here — they can carry personal data (emails, names).
    console.error("Unhandled Lambda error:", err instanceof Error ? err.message : "unknown error");
    return serverError();
  }
}
