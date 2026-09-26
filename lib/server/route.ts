import { getDeps, type Deps } from "./deps";
import { HttpError, json } from "./http";

type Params = Record<string, string>;

export type Handler<P extends Params = Params> = (req: Request, params: P, deps: Deps) => Promise<Response>;

/** Runs a handler, turning a thrown HttpError into its response and anything else into a bare 500. */
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
      return json(err.statusCode, { error: err.message, fieldErrors: err.fieldErrors });
    }
    // Never log request bodies or tokens — they carry personal data.
    console.error("Unhandled API error:", err instanceof Error ? err.message : "unknown error");
    return json(500, { error: "Something went wrong." });
  }
}

/** Adapts a handler to a Next.js route export: `export const POST = route(applyAsOrganiser);` */
export function route<P extends Params>(handler: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    let deps: Deps;
    try {
      deps = getDeps();
    } catch (err) {
      console.error("API misconfigured:", err instanceof Error ? err.message : "unknown error");
      return json(500, { error: "Something went wrong." });
    }
    return runHandler(handler, req, await ctx.params, deps);
  };
}
