"use client";

import LegalNote from "@/components/auth/LegalNote";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOfferedOAuthProviders } from "@/lib/auth/useOfferedOAuthProviders";

/**
 * /login's privacy line under the email form, when there are no Apple or
 * Google buttons: with them, OAuthButtons' own line (under the buttons, which
 * follow the form) is the page's, so it isn't said twice. The same check
 * OAuthButtons makes (so inside the phone app, which shows no buttons, it's here).
 */
export default function EmailOnlyLegalNote() {
  const auth = useAuth();
  const { providers } = useOfferedOAuthProviders(auth.configured);
  if (providers.length > 0) return null;
  return <LegalNote />;
}
