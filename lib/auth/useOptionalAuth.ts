"use client";

import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./AuthContext";

/**
 * The auth context if there is one. For components that also render outside
 * an AuthProvider (isolated tests, previews) and simply treat that as
 * "signed out" rather than throwing like `useAuth`.
 */
export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
