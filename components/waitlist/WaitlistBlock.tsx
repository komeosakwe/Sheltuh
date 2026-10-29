"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import DotsMark from "@/components/brand/DotsMark";
import DemoNotice from "@/components/DemoNotice";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { getWaitlistStatus, joinWaitlist, leaveWaitlist } from "@/lib/api/waitlist";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOSED = "The waitlist for this event is closed.";
const EMAIL_MISSING = "Enter your email address.";
const GENERIC_ERROR = "Couldn’t join the waitlist. Try again.";
const LEAVE_ERROR = "Couldn’t take you off the waitlist. Try again.";

type View =
  /** Signed in: checking whether they're on the list already. */
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "joined"; maskedEmail: string; already: boolean }
  | { kind: "sent"; email: string; expiresInHours: number }
  /** The API refused the event (409): `message` is its reason. */
  | { kind: "closed"; message: string };

/** Where focus goes after a change the person made. */
type Focus = "heading" | "email" | null;

/** The API's own words (no connection, a refusal, 503 busy); a server fault gets `fallback`. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status !== 500) return err.message;
  return fallback;
}

/**
 * The waitlist block of a sold-out event's ticket card
 * (docs/design/brand-direction-one.md §6.11): join with an email (the account
 * email, prefilled and editable, when signed in), or see that you're on it
 * and leave. A member joining with their own verified email is on the list at
 * once; anyone else is emailed a link to confirm (`/waitlist/confirm`).
 * Joining never reserves a ticket. `closed`: the event has ended, so there's
 * no form. `demo`: the form is shown disabled, with why.
 *
 * Focus follows the person's own actions only: to the new heading after
 * joining, the inbox message or leaving, and to the email field for an email
 * error. One polite status region says the rest.
 */
export default function WaitlistBlock({
  eventId,
  closed = false,
  demo = false,
}: {
  eventId: string;
  closed?: boolean;
  demo?: boolean;
}) {
  const auth = useOptionalAuth();
  const signedIn = !demo && auth?.status === "signed-in";
  const accountEmail = signedIn ? auth?.email : undefined;
  const getToken = signedIn ? auth?.getAccessToken : undefined;

  const [view, setView] = useState<View>(() => (signedIn && !closed ? { kind: "checking" } : { kind: "idle" }));
  const [statusError, setStatusError] = useState(false);
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const email = typedEmail ?? accountEmail ?? "";
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"join" | "leave" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<Focus>(null);
  // Bumped with every email error, so focus follows each one (even the same words again).
  const [emailErrorCount, setEmailErrorCount] = useState(0);

  // Signed in: are they on it already (by account, or a link they confirmed)?
  useEffect(() => {
    if (!getToken || closed) return;
    let cancelled = false;
    getWaitlistStatus(eventId, getToken).then(
      (status) => {
        if (cancelled) return;
        setView(
          status.joined ? { kind: "joined", maskedEmail: status.maskedEmail ?? "", already: true } : { kind: "idle" },
        );
      },
      () => {
        if (cancelled) return;
        // Not knowing doesn't stop them joining (joining again is harmless): say so, and offer the form.
        setStatusError(true);
        setView({ kind: "idle" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, closed]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "heading" ? headingRef.current : emailRef.current;
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  useEffect(() => {
    if (emailErrorCount > 0) emailRef.current?.focus();
  }, [emailErrorCount]);

  function showEmailError(message: string) {
    setEmailError(message);
    setEmailErrorCount((n) => n + 1);
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demo) return;
    setError(null);
    setEmailError(null);
    const address = email.trim();
    if (!EMAIL_REGEX.test(address)) {
      showEmailError(address ? "Enter a valid email address, like name@example.com." : EMAIL_MISSING);
      return;
    }
    setBusy("join");
    try {
      const result = await joinWaitlist(eventId, address, getToken);
      if (result.status === "joined") {
        setView({ kind: "joined", maskedEmail: result.maskedEmail, already: result.alreadyJoined });
      } else {
        setView({ kind: "sent", email: address, expiresInHours: result.expiresInHours });
      }
      setStatusError(false);
      pendingFocus.current = "heading";
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.email) {
        showEmailError(err.fieldErrors.email);
      } else if (err instanceof ApiError && err.status === 409) {
        setView({ kind: "closed", message: err.message || CLOSED });
        setAnnouncement(err.message || CLOSED);
      } else {
        setError(errorMessage(err, GENERIC_ERROR));
      }
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    if (busy || !getToken) return;
    setError(null);
    setBusy("leave");
    try {
      await leaveWaitlist({ eventId, getToken });
      setView({ kind: "idle" });
      setAnnouncement("You’ve left the waitlist.");
      pendingFocus.current = "heading";
    } catch (err) {
      setError(errorMessage(err, LEAVE_ERROR));
    } finally {
      setBusy(null);
    }
  }

  const status = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (closed) {
    return (
      <div className="border-t border-foreground pt-4">
        <p className="text-sm text-muted">{CLOSED}</p>
      </div>
    );
  }

  if (view.kind === "closed") {
    return (
      <div className="border-t border-foreground pt-4">
        <p className="text-sm text-muted">{view.message}</p>
        {status}
      </div>
    );
  }

  if (view.kind === "checking") {
    return (
      <div className="border-t border-foreground pt-4" aria-busy="true">
        <p role="status" className="text-sm text-muted">
          Checking the waitlist&hellip;
        </p>
      </div>
    );
  }

  if (view.kind === "joined") {
    return (
      <div className="flex flex-col gap-2 border-t border-foreground pt-4">
        <div className="flex items-center gap-3">
          <DotsMark size="sm" joined className="text-signal" />
          <h3 ref={headingRef} tabIndex={-1} className="font-heading text-xl text-foreground outline-offset-2">
            {view.already ? "You’re already on the waitlist" : "You’re on the waitlist"}
          </h3>
        </div>
        <p role="status" className="text-sm text-foreground">
          We&rsquo;ll email{" "}
          {view.maskedEmail ? <span className="break-all font-semibold">{view.maskedEmail}</span> : "you"} if tickets
          come up. Joining doesn&rsquo;t hold a ticket.
        </p>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {getToken && (
          <Button
            variant="outline"
            size="lg"
            busy={busy === "leave"}
            onClick={leave}
            className="mt-2 w-full sm:w-auto sm:self-start"
          >
            {busy === "leave" ? "Leaving…" : "Leave the waitlist"}
          </Button>
        )}
        {status}
      </div>
    );
  }

  if (view.kind === "sent") {
    return (
      <div className="flex flex-col gap-2 border-t border-foreground pt-4">
        <h3 ref={headingRef} tabIndex={-1} className="font-heading text-xl text-foreground outline-offset-2">
          Check your inbox
        </h3>
        <p role="status" className="text-sm text-foreground">
          Link sent to <span className="break-all font-semibold">{view.email}</span>. Press Confirm in the email within{" "}
          {view.expiresInHours} hours.
        </p>
        <p className="text-xs text-muted">Not there? Check spam.</p>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            pendingFocus.current = "email";
            setView({ kind: "idle" });
          }}
          className="mt-2 w-full sm:w-auto sm:self-start"
        >
          Use a different email
        </Button>
        {status}
      </div>
    );
  }

  const describedBy = ["waitlist-email-hint", emailError ? "waitlist-email-error" : null].filter(Boolean).join(" ");

  return (
    <form
      noValidate
      onSubmit={join}
      aria-labelledby="waitlist-title"
      aria-busy={busy === "join"}
      className="flex flex-col gap-3 border-t border-foreground pt-4"
    >
      <h3 id="waitlist-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl text-foreground outline-offset-2">
        Sold out. Join the waitlist.
      </h3>
      <p className="text-sm text-foreground">
        We&rsquo;ll email you if tickets are released. Joining doesn&rsquo;t reserve a ticket or charge you.
      </p>
      {statusError && (
        <p className="text-xs text-muted">
          Couldn&rsquo;t check the waitlist. Joining again is fine.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="waitlist-email" className="eyebrow text-muted">
          Email
        </label>
        <input
          ref={emailRef}
          id="waitlist-email"
          type="email"
          autoComplete="email"
          name="email"
          inputMode="email"
          required
          value={email}
          disabled={demo}
          onChange={(e) => {
            setTypedEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy}
          className={fieldClass}
        />
        <p id="waitlist-email-hint" className="text-xs text-muted">
          {accountEmail
            ? "Your account email joins now. Another address gets a confirm link."
            : "We’ll email a confirm link."}
        </p>
        {emailError && (
          <p id="waitlist-email-error" className="text-sm text-danger">
            {emailError}
          </p>
        )}
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {/* The page's one conversion action once checkout isn't possible (§6.11). */}
      <Button
        type="submit"
        variant="signal"
        size="lg"
        busy={busy === "join"}
        disabled={demo}
        className="w-full"
      >
        {busy === "join" ? "Joining…" : "Join waitlist"}
      </Button>
      {demo ? (
        <DemoNotice>Not available in this demo.</DemoNotice>
      ) : (
        <p className="text-xs text-muted">
          We only use your email for this event&rsquo;s waitlist, and every email has a link to leave it. See our{" "}
          <Link href="/privacy" className="text-foreground underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      )}
      {status}
    </form>
  );
}
