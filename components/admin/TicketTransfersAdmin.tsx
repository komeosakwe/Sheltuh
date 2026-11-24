"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import MessageField from "@/components/messages/MessageField";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import { adminCancelTicketTransfer, adminListTicketTransfers } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminTicketTransfer } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatDayTime } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";
import { adminListHref } from "./admin-list-url";
import { TICKET_TRANSFERS_HREF } from "./AdminSubNav";

/** An order's or a transfer's short reference as typed: 8 hex characters, with or without "#" (the API takes either). */
const REFERENCE = /^#?([0-9a-f]{8})$/i;

/** The API's rules for a cancel reason (lib/server/handlers/ticket-transfers.ts, ADMIN_REASON and EMAIL_LIKE). */
const REASON_MIN = 3;
const REASON_MAX = 500;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

const STATUS: Record<AdminTicketTransfer["status"], { label: string; tone: StatusTone }> = {
  pending: { label: "Waiting", tone: "pending" },
  accepted: { label: "Accepted", tone: "approved" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

const SENDER: Record<AdminTicketTransfer["senderKind"], string> = {
  paying_browser: "from the browser that paid",
  account: "the buyer, signed in",
  holder: "sent on by a recipient",
};

/** What the decision time is called, by status. */
const DECIDED: Record<Exclude<AdminTicketTransfer["status"], "pending">, string> = {
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

const HEADING_ID = "ticket-transfers-heading";

/** The id of an offer's heading in the list (focused after Load more). */
function itemHeadingId(transfer: AdminTicketTransfer) {
  return `ticket-transfer-${transfer.transferId}`;
}

/** What a search found, said once it's in: "3 offers for #A90133C9", "No ticket transfers for #A90133C9". */
export function searchResultText(reference: string, count: number, more: boolean): string {
  if (count === 0) return `No ticket transfers for ${reference}.`;
  return `${count}${more ? " or more" : ""} ${count === 1 && !more ? "offer" : "offers"} for ${reference}.`;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminTicketTransfer[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/** "#7C1F2E0A" for a valid reference, else null. */
export function normaliseReference(raw: string | null): string | null {
  const match = raw === null ? null : REFERENCE.exec(raw.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

/**
 * /admin/ticket-transfers: tickets sent to someone ("Send ticket to a
 * friend"), newest first, for support: find an order's (or one transfer's)
 * by its reference, kept in `?reference=` so other admin pages can link here
 * (Emails' "Find an order"). Addresses are masked by the API. An offer still
 * waiting can be cancelled with a reason; an accepted one can't be undone.
 * The page must render this inside a Suspense boundary (useSearchParams).
 */
export default function TicketTransfersAdmin() {
  const getToken = useAuth().getAccessToken;
  const router = useRouter();
  const params = useSearchParams();
  const rawReference = params.get("reference");
  const reference = normaliseReference(rawReference);
  const [typed, setTyped] = useState(reference ?? "");
  const [typedError, setTypedError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${reference ?? ""}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Where focus goes once the next render has it: the list's heading, or an item's heading (by id). */
  const pendingFocus = useRef<string | null>(null);
  /** What to say once the next load is in: a search's result, or that the list was loaded again. */
  const sayAfterLoad = useRef<"search" | "updated" | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === HEADING_ID ? headingRef.current : document.getElementById(target);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListTicketTransfers(getToken, reference ? { reference } : {}).then(
      (page) => {
        if (cancelled) return;
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        const say = sayAfterLoad.current;
        sayAfterLoad.current = null;
        if (say === "search" && reference) setAnnouncement(searchResultText(reference, page.items.length, Boolean(page.nextCursor)));
        else if (say === "updated") setAnnouncement("List updated.");
      },
      (err: unknown) => {
        if (cancelled) return;
        sayAfterLoad.current = null;
        setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load ticket transfers.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, reference, key]);

  function go(next: string | null) {
    router.replace(adminListHref(TICKET_TRANSFERS_HREF, { reference: next ?? undefined }), { scroll: false });
  }

  function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = normaliseReference(typed);
    if (!next) {
      setTypedError("Enter the 8-character reference, like #7C1F2E0A.");
      inputRef.current?.focus();
      return;
    }
    setTypedError(null);
    setTyped(next);
    setAnnouncement("");
    sayAfterLoad.current = "search";
    // The same reference again: look it up again (it may have changed).
    if (next === reference) setAttempt((n) => n + 1);
    else go(next);
  }

  function clear() {
    setTyped("");
    setTypedError(null);
    go(null);
    inputRef.current?.focus();
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListTicketTransfers(getToken, { ...(reference ? { reference } : {}), cursor: state.nextCursor });
      const known = new Set(state.items.map((t) => t.transferId));
      const added = page.items.filter((t) => !known.has(t.transferId));
      // Focus moves to the first offer just loaded (the button may be gone), and the count is said.
      if (added.length > 0) pendingFocus.current = itemHeadingId(added[0]);
      setAnnouncement(added.length === 1 ? "1 more offer loaded." : `${added.length} more offers loaded.`);
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: {
                status: "ready",
                items: [...current.state.items, ...added],
                nextCursor: page.nextCursor,
              },
            }
          : current,
      );
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more."));
    } finally {
      setLoadingMore(false);
    }
  }

  function cancelled(transfer: AdminTicketTransfer) {
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: {
              ...current.state,
              items: current.state.items.map((t) => (t.transferId === transfer.transferId ? transfer : t)),
            },
          }
        : current,
    );
    setAnnouncement(`Cancelled offer ${transfer.reference}.`);
  }

  /** Load the list again, then focus its heading (its button may have gone), saying so if `say`. */
  function reload(say: boolean) {
    pendingFocus.current = HEADING_ID;
    sayAfterLoad.current = say ? "updated" : null;
    setAnnouncement("");
    setAttempt((n) => n + 1);
  }

  const heading = reference ? `Ticket transfers for ${reference}` : "All offers, newest first";

  return (
    <div className="flex flex-col gap-6">
      <form role="search" aria-label="Find a ticket transfer" noValidate onSubmit={find} className="flex flex-wrap items-end gap-2">
        <div className="flex w-full max-w-xs min-w-0 flex-col gap-1">
          <label htmlFor="ticket-transfer-reference" className="eyebrow text-muted">
            Order or transfer reference
          </label>
          <input
            ref={inputRef}
            id="ticket-transfer-reference"
            name="reference"
            type="search"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setTypedError(null);
            }}
            placeholder="#7C1F2E0A"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            aria-invalid={typedError ? true : undefined}
            aria-describedby={typedError ? "ticket-transfer-reference-error" : undefined}
            className={`${fieldClass} font-mono`}
          />
        </div>
        <Button type="submit" variant="solid" size="sm" className="min-h-11">
          Find
        </Button>
        {reference && (
          <Button variant="outline" size="sm" className="min-h-11" onClick={clear}>
            Show all
          </Button>
        )}
        {typedError && (
          <p id="ticket-transfer-reference-error" role="alert" className="basis-full text-sm text-danger">
            {typedError}
          </p>
        )}
        {rawReference !== null && !reference && !typedError && (
          <p role="alert" className="basis-full text-sm text-danger">
            That link&rsquo;s reference isn&rsquo;t 8 characters like #7C1F2E0A, so every transfer is shown.
          </p>
        )}
      </form>

      <section aria-labelledby={HEADING_ID} aria-busy={state.status === "loading" ? true : undefined}>
        <h2 ref={headingRef} id={HEADING_ID} tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {heading}
        </h2>

        {state.status === "loading" && <LoadingState text="Loading…" />}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              {state.message}
            </Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => reload(false)}>
              Try again
            </Button>
          </div>
        )}

        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState title={reference ? `No ticket transfers for ${reference}` : "No tickets sent yet"} />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col">
            {state.items.map((transfer) => (
              <TransferItem
                key={transfer.transferId}
                transfer={transfer}
                onCancel={async (reason) => {
                  try {
                    await adminCancelTicketTransfer(transfer.transferId, reason, getToken);
                    cancelled({
                      ...transfer,
                      status: "cancelled",
                      cancelledBy: "admin",
                      cancelReason: reason,
                      decidedAt: new Date().toISOString(),
                    });
                    return { ok: true };
                  } catch (err) {
                    if (err instanceof ApiError && err.status === 400 && err.fieldErrors?.reason) {
                      return { ok: false, reasonError: err.fieldErrors.reason };
                    }
                    // Decided since (or gone): the list is out of date, so it's loaded again once the dialog closes.
                    const gone = err instanceof ApiError && (err.status === 409 || err.status === 404);
                    return { ok: false, message: errorText(err, "Couldn’t cancel it. Try again."), gone };
                  }
                }}
                onStale={() => reload(true)}
              />
            ))}
          </ul>
        )}

        {state.status === "ready" && state.nextCursor && (
          <div className="mt-6 flex flex-col items-start gap-3">
            {moreError && (
              <Notice tone="danger" role="alert">
                {moreError}
              </Notice>
            )}
            <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11">
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

type CancelOutcome = { ok: true } | { ok: false; reasonError: string } | { ok: false; message: string; gone: boolean };

function TransferItem({
  transfer,
  onCancel,
  onStale,
}: {
  transfer: AdminTicketTransfer;
  onCancel: (reason: string) => Promise<CancelOutcome>;
  onStale: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const status = STATUS[transfer.status];
  const time = (iso: string) => <time dateTime={iso}>{formatDayTime(iso)}</time>;

  return (
    <li className="border-t border-foreground py-4">
      <h3
        ref={headingRef}
        id={itemHeadingId(transfer)}
        tabIndex={-1}
        className="font-sans text-base font-semibold normal-case tracking-normal break-words outline-offset-2"
      >
        <span className="font-mono">{transfer.reference}</span> · order <span className="font-mono">{transfer.orderReference}</span>
      </h3>
      <p className="text-sm text-muted break-words">{transfer.eventTitle}</p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {transfer.supersededAt && <StatusBadge tone="neutral">Sent on since</StatusBadge>}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">From</dt>
        <dd className="break-words">
          {transfer.senderName} ({SENDER[transfer.senderKind]})
        </dd>
        <dt className="text-muted">To</dt>
        <dd className="break-words">
          {transfer.toName} · {transfer.toMaskedEmail}
        </dd>
        <dt className="text-muted">Sent</dt>
        <dd>{time(transfer.createdAt)}</dd>
        {transfer.status === "pending" && (
          <>
            <dt className="text-muted">Expires</dt>
            <dd>{time(transfer.expiresAt)}</dd>
          </>
        )}
        {transfer.status !== "pending" && transfer.decidedAt && (
          <>
            <dt className="text-muted">{DECIDED[transfer.status]}</dt>
            <dd>{time(transfer.decidedAt)}</dd>
          </>
        )}
        {transfer.holderName && (
          <>
            <dt className="text-muted">Held by</dt>
            <dd className="break-words">
              {transfer.holderName}
              {transfer.acceptedMaskedEmail && <> · {transfer.acceptedMaskedEmail}</>}
            </dd>
          </>
        )}
        {transfer.cancelledBy && (
          <>
            <dt className="text-muted">Cancelled by</dt>
            <dd>{transfer.cancelledBy === "admin" ? "Sheltüh support" : "The sender"}</dd>
          </>
        )}
        {transfer.cancelReason && (
          <>
            <dt className="text-muted">Reason</dt>
            <dd className="break-words whitespace-pre-wrap">{transfer.cancelReason}</dd>
          </>
        )}
      </dl>
      {transfer.status === "pending" && (
        <div className="mt-3">
          <Button
            ref={cancelButtonRef}
            variant="danger"
            size="sm"
            className="min-h-11"
            aria-label={`Cancel offer ${transfer.reference}`}
            onClick={() => setConfirming(true)}
          >
            Cancel offer
          </Button>
        </div>
      )}
      <CancelOfferDialog
        reference={confirming ? transfer.reference : null}
        onClose={(outcome) => {
          setConfirming(false);
          if (outcome === "stale") onStale();
          // Cancelled: the button is gone, so its offer's heading. Kept (Escape, "Keep it"): back to the button.
          else if (outcome === "cancelled") headingRef.current?.focus();
          else cancelButtonRef.current?.focus();
        }}
        onSubmit={onCancel}
      />
    </li>
  );
}

const TITLE_ID = "cancel-ticket-offer-title";
const WARNING_ID = "cancel-ticket-offer-warning";
const REASON_ID = "cancel-ticket-offer-reason";
const PROBLEM_ID = "cancel-ticket-offer-problem";

/** The reason's problem as the API would say it, or null. */
export function cancelReasonError(reason: string): string | null {
  const invalid = validateMessage(reason, { label: "Reasons", max: REASON_MAX, empty: "Enter a reason." });
  if (invalid) return invalid;
  if (Array.from(reason.trim()).length < REASON_MIN) return `Must be at least ${REASON_MIN} characters.`;
  if (EMAIL_LIKE.test(reason.normalize("NFKC"))) return "Leave email addresses out of the reason.";
  return null;
}

/**
 * "Cancel offer #…?": a modal dialog (native `<dialog>`: focus stays inside,
 * Escape closes it, except while the cancel is in flight). A reason is
 * required and kept with the offer. `onClose(outcome)` runs whenever it
 * closes: `cancelled`, `kept` (Escape or "Keep it"), or `stale` when the
 * offer was decided meanwhile (409, 404), so the list is loaded again. Tab
 * wraps inside it (keepFocusIn).
 */
function CancelOfferDialog({
  reference,
  onClose,
  onSubmit,
}: {
  /** The offer's reference; null when closed. */
  reference: string | null;
  onClose: (outcome: "cancelled" | "kept" | "stale") => void;
  onSubmit: (reason: string) => Promise<CancelOutcome>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = reference !== null;
  const busy = useRef(false);
  const outcome = useRef<"cancelled" | "kept" | "stale">("kept");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      outcome.current = "kept";
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(reason: string) {
    busy.current = true;
    try {
      const result = await onSubmit(reason);
      if (result.ok) outcome.current = "cancelled";
      else if ("gone" in result && result.gone) outcome.current = "stale";
      return result;
    } finally {
      busy.current = false;
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={TITLE_ID}
      aria-describedby={WARNING_ID}
      onCancel={(event) => {
        if (busy.current) event.preventDefault();
      }}
      onClose={() => onClose(outcome.current)}
      onKeyDown={keepFocusIn}
      className="mx-0 mt-auto mb-0 w-full max-w-none border-t border-foreground bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-foreground backdrop:bg-ink/50 sm:m-auto sm:max-w-lg sm:border sm:p-8"
    >
      {reference !== null && <CancelForm reference={reference} onDone={() => ref.current?.close()} onSubmit={submit} />}
    </dialog>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap inside the dialog (as the dashboard dialogs' keepFocusIn), so focus never reaches the browser's chrome. */
function keepFocusIn(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function CancelForm({
  reference,
  onDone,
  onSubmit,
}: {
  reference: string;
  onDone: () => void;
  onSubmit: (reason: string) => Promise<CancelOutcome>;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; gone: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  // Decided meanwhile: the dialog now only says so, and Close is the way on. Otherwise the problem itself.
  useEffect(() => {
    if (problem?.gone) closeRef.current?.focus();
    else if (problem) problemRef.current?.focus();
  }, [problem]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || problem?.gone) return;
    setProblem(null);
    const invalid = cancelReasonError(reason);
    setReasonError(invalid);
    if (invalid) {
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    const outcome = await onSubmit(reason.trim());
    setBusy(false);
    if (outcome.ok) {
      onDone();
    } else if ("reasonError" in outcome) {
      setReasonError(outcome.reasonError);
      reasonRef.current?.focus();
    } else {
      setProblem({ message: outcome.message, gone: outcome.gone });
    }
  }

  return (
    <form noValidate aria-busy={busy} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <h2 id={TITLE_ID} className="display-md !text-2xl break-words">
        {problem?.gone ? "This offer can’t be cancelled now" : `Cancel offer ${reference}?`}
      </h2>
      <p id={WARNING_ID} className="text-sm leading-5">
        {problem?.gone
          ? `${problem.message} Close this to see the list as it is now.`
          : "The link stops working and the ticket stays with whoever sent it. This can’t be undone."}
      </p>
      {!problem?.gone && (
        <MessageField
          id={REASON_ID}
          label="Reason (kept with the offer)"
          hint="No email addresses."
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (reasonError) setReasonError(null);
          }}
          error={reasonError}
          rows={3}
          max={REASON_MAX}
          inputRef={reasonRef}
        />
      )}
      {problem && !problem.gone && (
        <div id={PROBLEM_ID} ref={problemRef} tabIndex={-1} className="outline-offset-2">
          <Notice tone="danger">{problem.message}</Notice>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        {problem?.gone ? (
          <Button ref={closeRef} variant="solid" size="lg" aria-describedby={WARNING_ID} onClick={onDone} className="w-full sm:w-auto">
            Close
          </Button>
        ) : (
          <>
            <Button type="submit" variant="danger" size="lg" busy={busy} className="w-full sm:w-auto">
              {busy ? "Cancelling…" : "Cancel offer"}
            </Button>
            <Button variant="outline" size="lg" busy={busy} onClick={onDone} className="w-full sm:w-auto">
              Keep it
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
