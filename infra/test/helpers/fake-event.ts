import type { APIGatewayProxyResultV2 } from "aws-lambda";
import type { ApiEvent } from "../../lambda/shared/http";

/**
 * Every handler in this project only ever returns the object form of
 * APIGatewayProxyResultV2 (see shared/http.ts) — never the bare-string
 * shorthand the wider SDK type also allows. Tests call handlers through
 * this so they can assert on `.statusCode`/`.body` without fighting that
 * union at every call site.
 */
export type LambdaResult = { statusCode: number; headers?: Record<string, string>; body?: string };

export async function callHandler(
  handler: (event: ApiEvent) => Promise<APIGatewayProxyResultV2> | APIGatewayProxyResultV2,
  event: ApiEvent,
): Promise<LambdaResult> {
  return (await handler(event)) as LambdaResult;
}

interface FakeEventOptions {
  /** JWT claims from a verified Cognito token. Omit to simulate an unauthenticated request. */
  claims?: Record<string, unknown>;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
}

/** Builds a minimal API Gateway HTTP API v2 event for handler unit tests. */
export function fakeEvent(options: FakeEventOptions = {}): ApiEvent {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "test-account",
      apiId: "test-api",
      domainName: "test.execute-api.ap-southeast-2.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "test-request-id",
      routeKey: "$default",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
      authorizer: options.claims ? { jwt: { claims: options.claims, scopes: [] } } : undefined,
    },
    pathParameters: options.pathParameters,
    queryStringParameters: options.queryStringParameters,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    isBase64Encoded: false,
  } as unknown as ApiEvent;
}

/** Claims for a signed-in, non-admin user. */
export function organiserClaims(sub: string, email = `${sub}@example.com`): Record<string, unknown> {
  return { sub, email };
}

/** Claims for a signed-in admin (member of the "admins" Cognito group). */
export function adminClaims(sub: string, email = `${sub}@example.com`): Record<string, unknown> {
  return { sub, email, "cognito:groups": ["admins"] };
}
