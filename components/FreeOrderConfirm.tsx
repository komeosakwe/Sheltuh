"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { confirmFreeOrder } from "@/lib/api/orders";

type State =
  | { status: "loading" }
  | { status: "ready"; token: string }
  | { status: "confirming"; token: string }
  | { status: "missing" }
  | { status: "error"; title: string; message: string; token?: string };

/** The token from a `#token=…` fragment, if it's there. */
function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function errorState(err: unknown, token: string): State {
  if (err instanceof ApiError) {
    if (err.status === 410) {
      return { status: "error", title: "This link has expired", message: "Book again from the event page to get a new one." };
    }
    if (err.status === 404 || err.status === 400) {
      return {
        status: "error",
        title: "This link isn’t valid",
        message: "Open it straight from your email, making sure the whole link is used.",
      };
    }
    if (err.status === 409) return { status: "error", title: "We couldn’t issue these tickets", message: err.message };
  }
  return {
    status: "error",
    title: "Something went wrong",
    message: "We couldn’t confirm your tickets just now. Try again in a moment.",
    token,
  };
}

/**
 * /checkout/confirm#token=…: the link a guest is emailed to confirm free
 * tickets. Nothing happens until the button is pressed, so a mail scanner
 * opening the link can't confirm it. The token lives in the URL fragment
 * (never sent to any server); it's removed from the address bar as soon as
 * it's read, so it doesn't linger in history or get shared by accident.
 */
export default function FreeOrderConfirm() {
  const [state, setState] = useState<State>({ status: "loading" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The token, once read (null: there wasn't a valid one). Kept in a ref so
  // the read happens once per mount: StrictMode re-runs this effect after the
  // fragment has already been removed, and a second read would find nothing.
  // (Read in an effect, not a useState initialiser, so the server render and
  // hydration agree.)
  const capturedToken = useRef<{ token: string | null } | null>(null);

  useEffect(() => {
    if (!capturedToken.current) {
      capturedToken.current = { token: tokenFromHash(window.location.hash) };
      if (window.location.hash) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    const { token } = capturedToken.current;
    // Deferred so the effect body itself never calls setState.
    queueMicrotask(() => setState(token ? { status: "ready", token } : { status: "missing" }));
  }, []);

  useEffect(() => {
    if (state.status === "error" || state.status === "missing") headingRef.current?.focus();
  }, [state.status]);

  async function confirm(token: string) {
    setState({ status: "confirming", token });
    try {
      const { url } = await confirmFreeOrder(token);
      window.location.assign(url);
    } catch (err) {
      setState(errorState(err, token));
    }
  }

  if (state.status === "loading") {
    return <p className="py-16 text-center text-sm text-muted">Loading&hellip;</p>;
  }

  if (state.status === "missing" || state.status === "error") {
    const title = state.status === "missing" ? "This link is incomplete" : state.title;
    const message =
      state.status === "missing"
        ? "Open the link straight from your email, making sure the whole link is used."
        : state.message;
    const retryToken = state.status === "error" ? state.token : undefined;
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl text-foreground outline-offset-2">
          {title}
        </h1>
        <p role="alert" className="max-w-md text-sm text-muted">
          {message}
        </p>
        {retryToken && (
          <Button variant="outline" size="lg" className="mt-2" onClick={() => confirm(retryToken)}>
            Try again
          </Button>
        )}
        <Link href="/" className="mt-2 inline-flex min-h-11 items-center text-accent underline underline-offset-2">
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  const busy = state.status === "confirming";
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="display-md">Confirm your free tickets</h1>
      <p className="max-w-md text-sm text-muted">
        Press Confirm and your tickets are issued and emailed to you. Didn&rsquo;t ask for these? Just close this
        page: nothing is issued.
      </p>
      <Button variant="solid" size="lg" busy={busy} onClick={() => confirm(state.token)} className="w-full sm:w-auto">
        {busy ? "Confirming…" : "Confirm"}
      </Button>
      <p role="status" className="sr-only">
        {busy ? "Confirming your tickets…" : ""}
      </p>
    </div>
  );
}
