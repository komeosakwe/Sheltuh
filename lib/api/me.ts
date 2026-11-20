import { apiFetch, type GetToken } from "./client";
import type { AccountSummary } from "./types";

/**
 * The signed-in member's own account summary (GET /api/me; docs/architecture.md,
 * "API"): `upcomingCount`, the published events not started yet they hold a
 * ticket for. ApiError 401 (signed out), 403 (email not verified); or the abort
 * error if `signal` aborted.
 */
export async function getMe(getToken: GetToken, signal?: AbortSignal): Promise<AccountSummary> {
  const token = await getToken();
  return apiFetch<AccountSummary>("/me", { token, signal });
}
