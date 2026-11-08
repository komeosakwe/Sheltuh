"use client";

import { useEffect } from "react";
import { identifyUser, resetIdentity } from "@/lib/analytics";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";

/**
 * Tells analytics who is signed in: their Supabase user id and nothing else (no
 * email, name or phone number), and forgets them on sign-out so the next person
 * on this browser starts fresh. Renders nothing, and does nothing while
 * analytics is off. Waits out "loading" so a page load isn't taken for a sign-out.
 */
export default function AnalyticsIdentity() {
  const auth = useOptionalAuth();
  const status = auth?.status;
  const userId = auth?.userId;
  useEffect(() => {
    if (status === "signed-in" && userId) identifyUser(userId);
    else if (status === "signed-out") resetIdentity();
  }, [status, userId]);
  return null;
}
