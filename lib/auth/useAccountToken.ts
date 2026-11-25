"use client";

import { useCallback } from "react";
import type { GetToken } from "@/lib/api/client";
import type { AuthContextValue } from "./AuthContext";

/**
 * A token getter for the account `auth` shows as signed in, and only that account (AuthContext's
 * `getAccessTokenFor`, which reads the session when it's called): if the session is someone else's
 * by then (another account signed in, in another tab, before this page re-rendered), it rejects with
 * AccountMismatchError rather than hand over their token. For a request whose answer is filed under
 * that account (lib/auth/account-store.ts), so one account's answer is never kept as another's.
 */
export function useAccountToken(auth: Pick<AuthContextValue, "status" | "userId" | "email" | "getAccessTokenFor">): GetToken {
  const userId = auth.status === "signed-in" ? auth.userId : undefined;
  const email = auth.status === "signed-in" ? auth.email : undefined;
  const { getAccessTokenFor } = auth;
  return useCallback(() => getAccessTokenFor({ userId, email }), [getAccessTokenFor, userId, email]);
}
