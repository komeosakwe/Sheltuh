import { ApiError } from "@/lib/api/client";
import { SessionExpiredError } from "./session-token";

/**
 * Whether `err` (a request's failure) says nothing about the record: the request didn't reach the API or
 * get its answer (offline or a timeout: lib/api/client.ts's status 0, or an error that isn't the API's), the
 * API failed (5xx), or it asked us to slow down (429). Anything else the API answered (401, 403, any other
 * 4xx) and a session that's over (SessionExpiredError) are its answer.
 */
export function isTransientFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 429 || err.status >= 500;
  return !(err instanceof SessionExpiredError);
}
