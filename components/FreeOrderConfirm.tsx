"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { confirmFreeOrder } from "@/lib/api/orders";
import { seatErrorDetails } from "@/lib/api/seating";
import { compareSeats, formatSeatLine } from "@/lib/seating/format";
import { useFragmentToken } from "@/lib/link-token";

type Action =
  | { status: "idle" }
  | { status: "confirming" }
  /** `retry`: the same link may work if pressed again (anything but a refusal). `seatsHref`: choose seats again. */
  | { status: "error"; title: string; message: string; retry: boolean; seatsHref?: string };

type State =
  | { status: "loading" }
  | { status: "ready"; token: string }
  | { status: "confirming"; token: string }
  | { status: "missing" }
  | { status: "error"; title: string; message: string; token?: string; seatsHref?: string };

function errorAction(err: unknown): Action {
  if (err instanceof ApiError) {
    if (err.status === 410) {
      return { status: "error", title: "This link has expired", message: err.message || "Book again from the event page to get a new one.", retry: false };
    }
    if (err.status === 404 || err.status === 400) {
      return {
        status: "error",
        title: "This link isn’t valid",
        message: "Open it straight from your email, making sure the whole link is used.",
        retry: false,
      };
    }
    if (err.status === 409) {
      // A seated guest booking whose seats went to someone else before the link was confirmed
      // (docs/design/seating.md §5.11).
      const seats = seatErrorDetails(err);
      if (seats?.code === "seats_taken") {
        const lines = [...(seats.seats ?? [])].sort(compareSeats).map(formatSeatLine).join(", ");
        return {
          status: "error",
          title: "Those seats have gone",
          message: `Some of your seats were booked by someone else before you confirmed${lines ? `: ${lines}` : ""}. Nothing was booked.`,
          retry: false,
          ...(seats.eventSlug ? { seatsHref: `/events/${encodeURIComponent(seats.eventSlug)}/seats` } : {}),
        };
      }
      return { status: "error", title: "We couldn’t issue these tickets", message: err.message, retry: false };
    }
  }
  return {
    status: "error",
    title: "Something went wrong",
    message: "We couldn’t confirm your tickets just now. Try again in a moment.",
    retry: true,
  };
}

/**
 * /checkout/confirm#token=…: the link a guest is emailed to confirm free
 * tickets. Nothing happens until the button is pressed, so a mail scanner
 * opening the link can't confirm it. The token lives in the URL fragment
 * (never sent to any server); it's removed from the address bar as soon as
 * it's read (lib/link-token.ts), so it doesn't linger in history or get
 * shared by accident.
 */
export default function FreeOrderConfirm() {
  const fragment = useFragmentToken();
  const [action, setAction] = useState<Action>({ status: "idle" });
  const headingRef = useRef<HTMLHeadingElement>(null);

  const state: State =
    fragment.status !== "ready"
      ? fragment
      : action.status === "error"
        ? {
            status: "error",
            title: action.title,
            message: action.message,
            token: action.retry ? fragment.token : undefined,
            seatsHref: action.seatsHref,
          }
        : { status: action.status === "confirming" ? "confirming" : "ready", token: fragment.token };

  useEffect(() => {
    if (state.status === "error" || state.status === "missing") headingRef.current?.focus();
  }, [state.status]);

  async function confirm(token: string) {
    setAction({ status: "confirming" });
    try {
      const { url } = await confirmFreeOrder(token);
      window.location.assign(url);
    } catch (err) {
      setAction(errorAction(err));
    }
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted">
        Loading&hellip;
      </p>
    );
  }

  if (state.status === "missing" || state.status === "error") {
    const title = state.status === "missing" ? "This link is incomplete" : state.title;
    const message =
      state.status === "missing"
        ? "Open the link straight from your email, making sure the whole link is used."
        : state.message;
    const retryToken = state.status === "error" ? state.token : undefined;
    const seatsHref = state.status === "error" ? state.seatsHref : undefined;
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        {/* No role="alert" on the message: focus moves to the heading, which
            it describes, so it's read with the heading rather than twice. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          aria-describedby="free-order-message"
          className="font-heading text-2xl text-foreground outline-offset-2"
        >
          {title}
        </h1>
        <p id="free-order-message" className="max-w-md text-sm text-muted">
          {message}
        </p>
        {seatsHref && (
          <ButtonLink variant="solid" size="lg" href={seatsHref} className="mt-2 w-full sm:w-auto">
            Choose seats again
          </ButtonLink>
        )}
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
