"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { useFragmentToken } from "@/lib/link-token";

/** What a finished action shows: a heading, what it means, and where to go next. */
export interface LinkActionDone {
  title: string;
  body: ReactNode;
  links: { href: string; label: string }[];
}

/** A refusal or failure: its heading and message; `retry` when pressing again might work. */
export interface LinkActionError {
  title: string;
  message: string;
  retry: boolean;
}

const INVALID: LinkActionError = {
  title: "This link isn’t valid",
  message: "Open it straight from your email, making sure the whole link is used.",
  retry: false,
};

/**
 * The usual reading of an error from a link's POST: 400/404 an invalid link,
 * 410 expired (the API's words), no connection or a server fault worth
 * trying again. `overrides` handles anything else (a 409, say) first.
 */
export function linkActionError(
  err: unknown,
  what: string,
  overrides?: (err: ApiError) => LinkActionError | null,
): LinkActionError {
  if (err instanceof ApiError) {
    const special = overrides?.(err);
    if (special) return special;
    if (err.status === 400 || err.status === 404) return INVALID;
    if (err.status === 410) return { title: "This link has expired", message: err.message, retry: false };
    if (err.status === 0) return { title: "Something went wrong", message: err.message, retry: true };
  }
  return { title: "Something went wrong", message: `We couldn’t ${what} just now. Try again in a moment.`, retry: true };
}

type Step<T> =
  | { status: "idle" }
  | { status: "working" }
  | { status: "done"; result: T }
  | { status: "error"; error: LinkActionError };

/**
 * A page an email links to with a `#token=…` (waitlist confirm and leave,
 * follower-email unsubscribe): it says what pressing the button will do and
 * does nothing until it's pressed (a mail scanner opening the link changes
 * nothing). The token is read from the fragment once and removed from the
 * address bar (lib/link-token.ts). Every outcome is a heading that takes
 * focus, so it's read out; while working, a status region says so.
 */
export default function EmailLinkAction<T>({
  title,
  intro,
  action,
  busyLabel,
  working,
  run,
  done,
  error,
}: {
  title: string;
  intro: ReactNode;
  /** The button's label: says exactly what will happen. */
  action: string;
  busyLabel: string;
  /** Announced while the request runs. */
  working: string;
  run: (token: string) => Promise<T>;
  done: (result: T) => LinkActionDone;
  error: (err: unknown) => LinkActionError;
}) {
  const fragment = useFragmentToken();
  const [step, setStep] = useState<Step<T>>({ status: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const settled = fragment.status === "missing" || step.status === "done" || step.status === "error";

  useEffect(() => {
    if (settled) headingRef.current?.focus();
  }, [settled, step]);

  async function go(token: string) {
    setStep({ status: "working" });
    try {
      setStep({ status: "done", result: await run(token) });
    } catch (err) {
      setStep({ status: "error", error: error(err) });
    }
  }

  if (fragment.status === "loading") {
    return (
      <p role="status" className="py-16 text-sm text-muted">
        Loading&hellip;
      </p>
    );
  }

  if (fragment.status === "missing" || step.status === "error") {
    const shown =
      step.status === "error"
        ? step.error
        : { title: "This link is incomplete", message: INVALID.message, retry: false };
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        {/* The message describes the focused heading, so it's read once, with it. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          aria-describedby="link-action-message"
          className="font-heading text-2xl text-foreground outline-offset-2"
        >
          {shown.title}
        </h1>
        <p id="link-action-message" className="max-w-md text-sm text-muted">
          {shown.message}
        </p>
        {shown.retry && fragment.status === "ready" && (
          <Button variant="outline" size="lg" className="mt-2" onClick={() => go(fragment.token)}>
            Try again
          </Button>
        )}
        <Link href="/" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  if (step.status === "done") {
    const result = done(step.result);
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <p className="flex items-center gap-2 eyebrow text-foreground">
          <DotsMark size="xs" joined className="text-signal" />
          Done
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="display-md break-words outline-offset-2">
          {result.title}
        </h1>
        <div className="max-w-md text-sm leading-5">{result.body}</div>
        <ul className="mt-2 flex flex-col gap-1">
          {result.links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="inline-flex min-h-11 items-center underline underline-offset-4">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const busy = step.status === "working";
  return (
    <div className="flex flex-col items-start gap-4 py-16">
      <h1 className="display-md break-words">{title}</h1>
      <div className="max-w-md text-sm leading-5 text-muted">{intro}</div>
      <Button variant="solid" size="lg" busy={busy} onClick={() => go(fragment.token)} className="w-full sm:w-auto">
        {busy ? busyLabel : action}
      </Button>
      <p role="status" className="sr-only">
        {busy ? working : ""}
      </p>
    </div>
  );
}
