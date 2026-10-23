"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Emailed links carry their credential in the URL fragment (`#token=…`),
 * which browsers never send to a server: free-ticket confirmation, waitlist
 * confirm and leave, and follower-email unsubscribe. Every token is 32 random
 * bytes, base64url (43 characters).
 */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The token from a `#token=…` fragment, if it's there and well formed. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && LINK_TOKEN_PATTERN.test(token) ? token : null;
}

export type FragmentToken = { status: "loading" } | { status: "missing" } | { status: "ready"; token: string };

/**
 * Reads the page's `#token=…` once, then removes the fragment from the
 * address bar (so it doesn't linger in history or get shared by accident).
 * Nothing is sent anywhere: the page acts only when its button is pressed,
 * so a mail scanner opening the link does nothing.
 *
 * The read is kept in a ref, so StrictMode's second run of the effect (after
 * the fragment has gone) doesn't find nothing; and it's in an effect, not a
 * state initialiser, so the server render and hydration agree.
 */
export function useFragmentToken(): FragmentToken {
  const [state, setState] = useState<FragmentToken>({ status: "loading" });
  const captured = useRef<{ token: string | null } | null>(null);

  useEffect(() => {
    if (!captured.current) {
      captured.current = { token: tokenFromHash(window.location.hash) };
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    const { token } = captured.current;
    // Deferred so the effect body itself never calls setState.
    queueMicrotask(() => setState(token ? { status: "ready", token } : { status: "missing" }));
  }, []);

  return state;
}
