import { HttpError } from "./http";

/** The verified identity behind a request's bearer token. */
export interface Caller {
  userId: string;
  email?: string;
  /** From the user's app_metadata (only settable server-side — see scripts/promote-admin.ts). */
  isAdmin: boolean;
}

export type VerifyAccessToken = (token: string) => Promise<Caller | null>;

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export async function requireCaller(req: Request, verify: VerifyAccessToken): Promise<Caller> {
  const token = bearerToken(req);
  const caller = token ? await verify(token) : null;
  if (!caller) throw new HttpError(401, "Sign in required.");
  return caller;
}

export async function requireAdmin(req: Request, verify: VerifyAccessToken): Promise<Caller> {
  const caller = await requireCaller(req, verify);
  if (!caller.isAdmin) throw new HttpError(403, "Admin access required.");
  return caller;
}
