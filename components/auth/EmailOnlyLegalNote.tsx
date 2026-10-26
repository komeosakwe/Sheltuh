"use client";

import LegalNote from "@/components/auth/LegalNote";
import { useAuth } from "@/lib/auth/AuthContext";
import { offeredOAuthProviders } from "@/lib/auth/oauth";

/**
 * /login's privacy line under the email form, when there are no Apple or
 * Google buttons: with them, OAuthButtons' own line (above the form) is the
 * page's, so it isn't said twice. The same check OAuthButtons makes.
 */
export default function EmailOnlyLegalNote() {
  const auth = useAuth();
  if (offeredOAuthProviders(auth.configured).length > 0) return null;
  return <LegalNote />;
}
