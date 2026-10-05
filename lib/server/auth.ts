import { HttpError } from "./http";

/** The verified identity behind a request's bearer token. */
export interface Caller {
  userId: string;
  email?: string;
  /** Whether Supabase Auth has confirmed `email` (the user's email_confirmed_at is set). */
  emailVerified: boolean;
  /** From the user's app_metadata (only settable server-side — see scripts/promote-admin.ts). */
  isAdmin: boolean;
}

/** A caller whose email address Supabase Auth has confirmed. */
export type VerifiedCaller = Caller & { email: string; emailVerified: true };

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

/**
 * A signed-in caller with a confirmed email. Social features match tickets to
 * people by email, so an unconfirmed address can't be trusted to be theirs.
 */
export async function requireVerifiedCaller(req: Request, verify: VerifyAccessToken): Promise<VerifiedCaller> {
  const caller = await requireCaller(req, verify);
  if (!caller.emailVerified || !caller.email) {
    throw new HttpError(403, "Verify your email address first.");
  }
  return { ...caller, email: caller.email, emailVerified: true };
}

export async function requireAdmin(req: Request, verify: VerifyAccessToken): Promise<Caller> {
  const caller = await requireCaller(req, verify);
  if (!caller.isAdmin) throw new HttpError(403, "Admin access required.");
  return caller;
}
