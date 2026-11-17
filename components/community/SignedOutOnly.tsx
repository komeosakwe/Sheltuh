"use client";

import type { ReactNode } from "react";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";

/**
 * Its children only for visitors who aren't signed in (signed out, the demo, and while the
 * session is read, as the server renders it), e.g. "Join free".
 */
export default function SignedOutOnly({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  return auth?.status === "signed-in" ? null : children;
}
