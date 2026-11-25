"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import FullTicket from "@/components/tickets/FullTicket";
import { useTicketEvent } from "@/components/tickets/useTicketEvent";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { acceptTicketOffer, declineTicketOffer, viewTicketOffer } from "@/lib/api/ticket-transfers";
import type { TicketOffer, TicketOfferErrorCode } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { eventZone } from "@/lib/format";
import { useFragmentToken } from "@/lib/link-token";
import { firstName, PERSON_NAME_MAX_LENGTH } from "@/lib/person-name";
import { bareSuburb } from "@/lib/place";
import { withNext } from "@/lib/safe-next-path";
import { ticketStubDate, ticketStubTime } from "@/lib/ticket-times";
import { MAX_HELD_TICKETS_PER_EVENT } from "@/lib/ticket-transfer-rules";
import { forgetOfferToken, keepOfferToken, keptOfferToken } from "@/lib/ticket-transfer-return";

export const ACCEPT_PATH = "/tickets/accept";
/** The one answer for every offer that can't be opened (the API's own words: a link's history isn't told). */
export const OFFER_UNAVAILABLE = "This ticket offer has expired or was already used.";

const SIGN_IN_HREF = withNext("/login", ACCEPT_PATH);
const SIGN_UP_HREF = withNext("/signup", ACCEPT_PATH);

/** What each refusal of an accept says (`{First}` is the sender's first name). */
export function acceptErrorMessage(code: TicketOfferErrorCode, sender: string): string {
  switch (code) {
    case "own_ticket":
      return "This ticket is from your own order, so there’s nothing to accept.";
    case "transfers_closed":
      return "It’s too close to the event to accept this ticket.";
    case "ticket_unavailable":
      return `This ticket can’t be accepted any more. Ask ${sender} about it.`;
    case "received_cap":
      return `You already hold ${MAX_HELD_TICKETS_PER_EVENT} tickets for this event.`;
    case "rate_limited":
      return "Too many tries. Wait a little, then try again.";
  }
}

const ACCEPT_ERROR_CODES: readonly TicketOfferErrorCode[] = ["own_ticket", "transfers_closed", "ticket_unavailable", "received_cap", "rate_limited"];

function offerErrorCode(err: unknown): TicketOfferErrorCode | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === "string" && (ACCEPT_ERROR_CODES as readonly string[]).includes(code) ? (code as TicketOfferErrorCode) : null;
}

type OfferLink = { status: "loading" } | { status: "missing" } | { status: "ready"; token: string; decline: boolean };

/**
 * The accept link's token: from the fragment (`#token=…`, and `&decline=1` from the email's Decline), which
 * is then taken out of the address bar, or the one this tab kept while its recipient signed in. Kept in this
 * tab's sessionStorage until it's used or the server says it can't be (lib/ticket-transfer-return.ts).
 */
function useOfferLink(): OfferLink {
  const fragment = useFragmentToken();
  const [link, setLink] = useState<OfferLink>({ status: "loading" });
  useEffect(() => {
    if (fragment.status === "loading") return;
    // Deferred so the effect body itself never calls setState.
    queueMicrotask(() => {
      if (fragment.status === "ready") {
        keepOfferToken(fragment.token);
        setLink({ status: "ready", token: fragment.token, decline: new URLSearchParams(fragment.fragment).get("decline") === "1" });
        return;
      }
      const kept = keptOfferToken();
      setLink(kept ? { status: "ready", token: kept, decline: false } : { status: "missing" });
    });
  }, [fragment]);
  return link;
}

/** Focuses the page's heading when what's on screen changes (not on the first screen): it's read out. */
function useFocusOnScreenChange(id: string) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (id === "loading" || shown.current === id) return;
    const first = shown.current === null;
    shown.current = id;
    if (!first) headingRef.current?.focus();
  }, [id]);
  return headingRef;
}

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: unknown };
type OpenOffer = Extract<TicketOffer, { status: "open" }>;

const titleClass = "label-menu break-words text-foreground outline-offset-2 focus:outline-none!";
const quietLinkClass = "body-s inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4";

/**
 * Where a sent ticket is accepted (`/tickets/accept#token=…`; Latte's 1120
 * "Accept ticket" frames at 1440 / 768 / 390, inside the account frame).
 * Opening the link only reads the offer (a mail scanner opening it changes
 * nothing): "From Alex Chen", "Alex sent you a ticket", the ticket (the
 * orange-outline ticket with its QR locked: owner rule), then Accept
 * ticket and Decline, who's signed in, and what each choice does.
 *
 * - **Signed in:** "Your name" (the name the sender typed, to confirm: it's
 *   shared with the organiser), then Accept ticket, which goes to the
 *   received ticket. "Not you? Switch account" signs out here and back in.
 * - **Signed out:** sign in or create an account, then back here (the token
 *   waits in this tab); Decline works signed out.
 * - **Decline** asks first ("Decline this ticket? It goes back to Alex."),
 *   also when the email's Decline opened the page (`&decline=1`).
 * - Every offer that can't be opened (expired, used, cancelled, unknown)
 *   gets the same answer. Each new screen's heading takes focus.
 */
export default function AcceptTicketFlow() {
  const auth = useAuth();
  const router = useRouter();
  const link = useOfferLink();
  const token = link.status === "ready" ? link.token : null;
  const configured = isApiConfigured && auth.configured;
  const signedIn = auth.status === "signed-in";
  const who = auth.status === "loading" ? null : signedIn ? (auth.userId ?? "") : "out";

  const [attempt, setAttempt] = useState(0);
  const viewKey = configured && token && who !== null ? `${token}#${who}#${attempt}` : null;
  const [viewResult, setViewResult] = useState<{ key: string; load: Load<TicketOffer> } | null>(null);
  /** The offer turned out unusable while accepting or declining. */
  const [gone, setGone] = useState(false);
  const [declined, setDeclined] = useState(false);
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (!viewKey || !token) return;
    let cancelled = false;
    viewTicketOffer(token, signedIn ? getToken : undefined).then(
      (value) => {
        if (!cancelled) setViewResult({ key: viewKey, load: { status: "ready", value } });
      },
      (error: unknown) => {
        if (!cancelled) setViewResult({ key: viewKey, load: { status: "error", error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [viewKey, token, signedIn, getToken]);

  const view: Load<TicketOffer> | null = viewKey ? (viewResult?.key === viewKey ? viewResult.load : { status: "loading" }) : null;
  const unavailable = gone || (view?.status === "error" && view.error instanceof ApiError && view.error.status === 404);
  const acceptedId = view?.status === "ready" && view.value.status === "accepted" ? view.value.transferId : null;

  // A link that can't be used, or has been, is forgotten.
  useEffect(() => {
    if (unavailable || declined || acceptedId) forgetOfferToken();
  }, [unavailable, declined, acceptedId]);

  // This account accepted it already: its ticket.
  useEffect(() => {
    if (acceptedId) router.replace(`/tickets/received/${encodeURIComponent(acceptedId)}`);
  }, [acceptedId, router]);

  const offer: OpenOffer | null = view?.status === "ready" && view.value.status === "open" ? view.value : null;
  const screenId = !configured
    ? "demo"
    : link.status === "missing"
      ? "missing"
      : declined
        ? "declined"
        : unavailable
          ? "unavailable"
          : view?.status === "error"
            ? "error"
            : offer
              ? "offer"
              : "loading";
  const headingRef = useFocusOnScreenChange(screenId);

  if (!configured) {
    return (
      <Message headingRef={headingRef} title="Ticket offers work on the live site">
        <DemoNotice>Ticket offers can’t be opened in this demo. Nothing was changed.</DemoNotice>
        <FindEvents />
      </Message>
    );
  }
  if (link.status === "missing") {
    return (
      <Message headingRef={headingRef} title="Open the link in your email">
        <p className="body-m text-muted">This page needs the link from the email you were sent, opened in full.</p>
        <FindEvents />
      </Message>
    );
  }
  if (declined) {
    return (
      <Message headingRef={headingRef} title="You declined the ticket">
        <p className="body-m text-muted">{offer ? `We’ve let ${firstName(offer.fromName)} know.` : "We’ve let them know."}</p>
        <FindEvents />
      </Message>
    );
  }
  if (unavailable) {
    return (
      <Message headingRef={headingRef} title={OFFER_UNAVAILABLE}>
        <p className="body-m text-muted">Ask the person who sent it to send it again.</p>
        <FindEvents />
      </Message>
    );
  }
  if (view?.status === "error") {
    const rateLimited = view.error instanceof ApiError && view.error.status === 429;
    return (
      <Message headingRef={headingRef} title="Couldn’t open this ticket">
        <p role="alert" className="body-m text-danger">
          {rateLimited ? "Too many tries. Wait a little, then try again." : "Something went wrong. Try again."}
        </p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)} className="w-full sm:w-auto">
          Try again
        </Button>
      </Message>
    );
  }
  if (!offer) {
    return (
      <Column>
        <LoadingState text="Opening your ticket…" />
      </Column>
    );
  }
  return (
    <OfferView
      key={token}
      offer={offer}
      token={token as string}
      startWithDecline={link.status === "ready" && link.decline}
      headingRef={headingRef}
      onGone={() => setGone(true)}
      onDeclined={() => setDeclined(true)}
      onAccepted={(transferId) => {
        forgetOfferToken();
        router.push(`/tickets/received/${encodeURIComponent(transferId)}`);
      }}
    />
  );
}

/** Latte's content column: 480 wide from 768, centred; the full width on phones. Parts 24 apart. */
function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-120 flex-col gap-6">{children}</div>;
}

function Message({ title, children, headingRef }: { title: string; children: ReactNode; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <Column>
      <h1 ref={headingRef} tabIndex={-1} className={titleClass}>
        {title}
      </h1>
      {children}
    </Column>
  );
}

function FindEvents() {
  return (
    <Link href="/events" className={quietLinkClass}>
      Find events
    </Link>
  );
}

function OfferView({
  offer,
  token,
  startWithDecline,
  headingRef,
  onGone,
  onDeclined,
  onAccepted,
}: {
  offer: OpenOffer;
  token: string;
  startWithDecline: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onGone: () => void;
  onDeclined: () => void;
  onAccepted: (transferId: string) => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const id = useId();
  const signedIn = auth.status === "signed-in";
  const sender = firstName(offer.fromName);
  const [holderName, setHolderName] = useState(offer.toName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ message: string; action?: { href: string; label: string } } | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(startWithDecline);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const shownConfirm = useRef(false);

  // The decline question takes focus as it appears (it's read out); "Keep it" puts focus back on Decline.
  useEffect(() => {
    if (confirmDecline) confirmRef.current?.focus();
    else if (shownConfirm.current) declineRef.current?.focus();
    shownConfirm.current = confirmDecline;
  }, [confirmDecline]);

  const listed = offer.eventListed;
  const event = useTicketEvent(listed ? (offer.eventSlug ?? null) : null);
  const zone = eventZone(offer.eventTimeZone);
  const startsAt = listed ? offer.eventStartsAt : undefined;
  const suburb = offer.suburb ? bareSuburb(offer.suburb, offer.eventState) : "";
  const venueLine = listed ? [offer.venueName?.trim() ?? "", suburb].filter(Boolean).join(" · ") : "";
  const art = event ? (
    <EventArt poster={event.poster} title={event.title} imageUrl={event.imageUrl} imageFocus={event.imageFocus} className="size-full" />
  ) : undefined;

  async function accept(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (busy) return;
    const name = holderName.trim();
    if (!name) {
      setNameError("Enter your name");
      nameRef.current?.focus();
      return;
    }
    setBusy("accept");
    setFormError(null);
    try {
      const result = await acceptTicketOffer(token, name, auth.getAccessToken);
      onAccepted(result.transferId);
    } catch (err) {
      setBusy(null);
      if (err instanceof ApiError && err.status === 404) return onGone();
      const fieldError = err instanceof ApiError ? err.fieldErrors?.holderName : undefined;
      if (fieldError) {
        setNameError(fieldError);
        nameRef.current?.focus();
        return;
      }
      const code = offerErrorCode(err);
      if (code) return setFormError({ message: acceptErrorMessage(code, sender) });
      // The session ended (the API's 401, or no token to be had): sign in again, back here (the token waits).
      if ((err instanceof ApiError && err.status === 401) || err instanceof SessionExpiredError) {
        return setFormError({ message: "Your session has ended. Sign in again to accept.", action: { href: SIGN_IN_HREF, label: "Sign in" } });
      }
      if (err instanceof ApiError && err.status === 403) {
        return setFormError({
          message: "Confirm your email address to accept this ticket.",
          action: { href: withNext("/verify", ACCEPT_PATH, auth.email ? { email: auth.email } : {}), label: "Verify your email" },
        });
      }
      setFormError({ message: "Couldn’t accept the ticket. Try again." });
    }
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setFormError(null);
    try {
      await declineTicketOffer(token);
      onDeclined();
    } catch (err) {
      setBusy(null);
      if (err instanceof ApiError && err.status === 404) return onGone();
      setFormError({
        message: err instanceof ApiError && err.status === 429 ? "Too many tries. Wait a little, then try again." : "Couldn’t decline the ticket. Try again.",
      });
    }
  }

  function switchAccount() {
    // The token stays in this tab: back here after signing in as someone else.
    auth.signOut("local");
    router.push(SIGN_IN_HREF);
  }

  const errorLine = formError && (
    <div role="alert" className="flex flex-wrap items-center gap-x-2">
      <p className="body-s text-danger">{formError.message}</p>
      {formError.action && (
        <Link href={formError.action.href} className={quietLinkClass}>
          {formError.action.label}
        </Link>
      )}
    </div>
  );

  return (
    <Column>
      <div className="flex flex-col gap-2">
        <p className="body-s font-semibold break-words text-signal-text">From {offer.fromName}</p>
        <h1 ref={headingRef} tabIndex={-1} className={titleClass}>
          {sender} sent you a ticket
        </h1>
        <p className="body-m text-muted">Accept it to get your own QR code for the door.</p>
      </div>

      <FullTicket
        locked
        eventTitle={offer.eventTitle}
        image={art}
        venueLine={venueLine || undefined}
        date={startsAt ? ticketStubDate(startsAt, offer.eventTimeZone) : undefined}
        time={startsAt ? ticketStubTime(startsAt, offer.eventEndsAt, offer.eventTimeZone) : undefined}
        holderName={signedIn ? holderName.trim() || offer.toName : offer.toName}
        typeName={offer.ticketTypeName}
        group={offer.group}
        seat={offer.seat}
        eventUnlisted={!listed}
        timeZone={zone}
        headingLevel={2}
      />

      {confirmDecline ? (
        <section aria-labelledby={`${id}-decline`} className="flex flex-col gap-4 rounded-card border border-surface-border p-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-decline`} ref={confirmRef} tabIndex={-1} className="text-xl leading-7 font-semibold outline-offset-2 focus:outline-none!">
              Decline this ticket?
            </h2>
            <p className="body-s text-muted">It goes back to {sender}.</p>
          </div>
          {errorLine}
          <Button variant="outline" busy={busy === "decline"} onClick={() => void decline()} className="w-full">
            {busy === "decline" ? "Declining…" : "Decline ticket"}
          </Button>
          <button type="button" onClick={() => setConfirmDecline(false)} className={`${quietLinkClass} self-center`}>
            Keep it
          </button>
        </section>
      ) : signedIn ? (
        <form noValidate onSubmit={accept} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-name`} className="body-s font-semibold text-foreground">
              Your name
            </label>
            <input
              ref={nameRef}
              id={`${id}-name`}
              value={holderName}
              onChange={(e) => {
                setHolderName(e.target.value);
                setNameError(null);
              }}
              autoComplete="name"
              maxLength={PERSON_NAME_MAX_LENGTH}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={`${nameError ? `${id}-name-error ` : ""}${id}-name-hint`}
              className="body-m min-h-12 w-full rounded-control border border-foreground bg-card px-4 py-3 text-foreground placeholder:text-disabled aria-invalid:border-danger"
            />
            {nameError && (
              <p id={`${id}-name-error`} role="alert" className="body-s text-danger">
                {nameError}
              </p>
            )}
            <div id={`${id}-name-hint`} className="body-s flex flex-col gap-1 text-muted">
              <p>Your name and email are shared with the organiser of this event.</p>
              <p>{sender} will see your name, and your email (partly hidden) if it isn’t the one they sent this to.</p>
            </div>
          </div>
          {errorLine}
          <div className="flex flex-col gap-6">
            <Button type="submit" variant="signal" busy={busy === "accept"} className="w-full">
              {busy === "accept" ? "Accepting…" : "Accept ticket"}
            </Button>
            <Button ref={declineRef} variant="outline" onClick={() => setConfirmDecline(true)} className="w-full">
              Decline
            </Button>
          </div>
          <p className="body-s break-words text-muted">
            Signed in as {auth.email} · Not you?{" "}
            <button type="button" onClick={switchAccount} className="-my-3 inline-flex min-h-11 items-center underline-offset-4 hover:underline">
              Switch account
            </button>
          </p>
        </form>
      ) : (
        <div className="flex flex-col gap-6">
          {/* The owner's wording (21 Nov): any signed-in account can accept, not only the address it was sent to. */}
          <p className="body-m text-muted">Sign in or create an account, then accept to get your own QR code.</p>
          {errorLine}
          <ButtonLink variant="signal" href={SIGN_IN_HREF} className="w-full">
            Sign in to accept
          </ButtonLink>
          <ButtonLink variant="outline" href={SIGN_UP_HREF} className="w-full">
            Create account
          </ButtonLink>
          <Button ref={declineRef} variant="outline" onClick={() => setConfirmDecline(true)} className="w-full">
            Decline
          </Button>
        </div>
      )}

      <p className="body-s text-muted">
        Once you accept, {sender}’s copy stops working. If you decline, it goes back to {sender}.
      </p>
    </Column>
  );
}
