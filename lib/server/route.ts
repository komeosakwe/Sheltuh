import { getDeps, type Deps } from "./deps";
import { redactForLog } from "./email-address";
import { errorJson, HttpError } from "./http";

type Params = Record<string, string>;

export type Handler<P extends Params = Params> = (req: Request, params: P, deps: Deps) => Promise<Response>;

/**
 * An unexpected error's message as it may be logged (redactForLog): email
 * addresses and order ids redacted (a Stripe error can quote our idempotency
 * key, e.g. `checkout-session-ord_…`), control characters dropped, length
 * bounded.
 */
export function errorMessageForLog(err: unknown): string {
  return redactForLog(err instanceof Error ? err.message : "unknown error");
}

/**
 * Runs a handler, turning a thrown HttpError into its response and anything
 * else into a bare 500. Error responses are `private, no-store`: many are
 * about the caller (their conversation, their block), and none is worth caching.
 */
export async function runHandler<P extends Params>(
  handler: Handler<P>,
  req: Request,
  params: P,
  deps: Deps,
): Promise<Response> {
  try {
    return await handler(req, params, deps);
  } catch (err) {
    if (err instanceof HttpError) {
      return errorJson(err.statusCode, { ...err.details, error: err.message, fieldErrors: err.fieldErrors }, err.headers);
    }
    // Never log request bodies or tokens — they carry personal data.
    console.error("Unhandled API error:", errorMessageForLog(err));
    return errorJson(500, { error: "Something went wrong." });
  }
}

/** Adapts a handler to a Next.js route export: `export const POST = route(applyAsOrganiser);` */
export function route<P extends Params>(handler: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    let deps: Deps;
    try {
      deps = getDeps();
    } catch (err) {
      console.error("API misconfigured:", errorMessageForLog(err));
      return errorJson(500, { error: "Something went wrong." });
    }
    return runHandler(handler, req, await ctx.params, deps);
  };
}
