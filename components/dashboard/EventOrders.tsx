"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import AnalyticsGate from "@/components/analytics/AnalyticsGate";
import { saveBlob } from "@/components/analytics/ExportCsvButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { backLinkClass } from "@/components/ui/BackLink";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import Strap from "@/components/ui/Strap";
import { ApiError, type GetToken } from "@/lib/api/client";
import { downloadEventOrdersCsv, getEventOrders } from "@/lib/api/event-orders";
import type { EventOrderRow, EventOrdersPage } from "@/lib/api/types";
import { DETAILS_VISIBLE_MONTHS, ORGANISER_USE_NOTE } from "@/lib/buyer-details";
import { orderPaidText, orderPlacedText, orderStatusText, orderTicketsText } from "@/lib/event-orders-format";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX = 100;
const NONE = "—";

/** /dashboard/events/[id]/orders: who bought tickets to one of your events (names and emails for 12 months after it ends). */
export default function EventOrders({ eventId }: { eventId: string }) {
  return (
    <AnalyticsGate
      title="Orders"
      returnTo={`/dashboard/events/${encodeURIComponent(eventId)}/orders`}
      signInTitle="Sign in to see your orders"
      need="see orders"
    >
      {(getToken) => <Orders eventId={eventId} getToken={getToken} />}
    </AnalyticsGate>
  );
}

interface Loaded {
  q: string;
  page: EventOrdersPage;
  items: EventOrderRow[];
  nextCursor?: string;
}

function readError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return "Too many searches. Wait a few minutes, then try again.";
  return "Couldn’t load orders.";
}

function exportError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Your session has ended. Sign in again to export.";
  if (error instanceof ApiError && error.status === 429) return "Too many exports. Try again in an hour.";
  if (error instanceof ApiError && error.status === 409) return error.message;
  return "Couldn’t prepare the file. Try again.";
}

function Orders({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const searchId = useId();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ q: string; error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // The search runs 300 ms after the last keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    let cancelled = false;
    getEventOrders(eventId, getToken, { q, limit: PAGE_SIZE }).then(
      (page) => {
        if (cancelled) return;
        setFailed(null);
        setMore({ busy: false, error: null });
        setLoaded({ q, page, items: page.items, nextCursor: page.nextCursor });
      },
      (error: unknown) => {
        if (!cancelled) setFailed({ q, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, q, attempt]);

  async function showMore() {
    if (!loaded?.nextCursor) return;
    const { q: forQ, nextCursor } = loaded;
    setMore({ busy: true, error: null });
    try {
      const page = await getEventOrders(eventId, getToken, { q: forQ, cursor: nextCursor, limit: PAGE_SIZE });
      setLoaded((prev) =>
        prev && prev.q === forQ ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
      );
      setMore({ busy: false, error: null });
    } catch (error) {
      setMore({ busy: false, error: readError(error) });
    }
  }

  async function exportCsv() {
    if (!loaded) return;
    setExporting(true);
    setExportMessage(null);
    try {
      saveBlob(await downloadEventOrdersCsv(eventId, getToken), `sheltuh-${loaded.page.event.slug}-orders.csv`);
    } catch (error) {
      setExportMessage(exportError(error));
    } finally {
      setExporting(false);
    }
  }

  const back = (
    <nav aria-label="Event" className="mb-6 flex flex-wrap gap-x-6">
      <Link href={`/dashboard/${encodeURIComponent(eventId)}`} className={backLinkClass}>
        &larr; Edit event
      </Link>
    </nav>
  );

  if (failed?.q === q && failed.error instanceof ApiError && failed.error.status === 404) {
    return (
      <>
        {back}
        <EmptyState
          headingLevel={1}
          title="Event not found"
          action={
            <ButtonLink size="lg" variant="outline" href="/dashboard">
              Back to events
            </ButtonLink>
          }
        >
          It may have been deleted, or it belongs to another organiser account.
        </EmptyState>
      </>
    );
  }

  const event = loaded?.page.event;
  const searching = loaded !== null && (loaded.q !== q || typed.trim() !== q) && failed?.q !== q;
  const total = loaded?.page.total ?? 0;
  const count = loaded
    ? loaded.q
      ? `${total} ${total === 1 ? "order matches" : "orders match"} “${loaded.q}”.`
      : `${total} ${total === 1 ? "order" : "orders"}.`
    : "";
  const emptyText = loaded?.q ? `No orders match “${loaded.q}”.` : "No orders yet.";
  const expired = loaded ? Date.parse(loaded.page.detailsVisibleUntil) <= new Date().getTime() : false;
  const canExport = loaded !== null && (loaded.page.total > 0 || loaded.q !== "");

  return (
    <>
      {back}
      <header className="mb-8 flex flex-col gap-3">
        <Strap label="Orders" rule={false} />
        <h1 className="display-md break-words">Orders</h1>
        {event && <p className="meta text-muted break-words">{event.title || "Untitled event"}</p>}
      </header>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex w-full max-w-md flex-col gap-1">
          <label htmlFor={searchId} className="eyebrow text-muted">
            Search orders
          </label>
          <input
            id={searchId}
            type="search"
            name="q"
            autoComplete="off"
            maxLength={SEARCH_MAX}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="min-h-12 px-3 py-2 text-base"
          />
          <p className="text-xs text-muted">Name, email or reference.</p>
        </div>
        {canExport && (
          <div className="flex flex-col items-start gap-2 sm:max-w-xs sm:items-end sm:text-right">
            <Button variant="outline" className="min-h-11" busy={exporting} onClick={() => void exportCsv()}>
              {exporting ? "Preparing…" : "Export CSV"}
            </Button>
            <p className="text-xs text-muted">{ORGANISER_USE_NOTE}</p>
            {exportMessage && (
              <Notice tone="danger" role="alert">
                {exportMessage}
              </Notice>
            )}
          </div>
        )}
      </div>

      {failed?.q === q && (
        <div className="mb-6">
          <Notice tone="danger" role="alert">
            {readError(failed.error)}
          </Notice>
          <Button variant="outline" size="lg" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {!loaded || (failed?.q === q && loaded.q !== q) ? (
        failed?.q === q ? null : (
          <div aria-busy="true" className="min-h-48">
            <LoadingState text="Loading orders…" />
          </div>
        )
      ) : (
        <div aria-busy={searching}>
          <p role="status" className="mb-3 text-sm text-muted">
            {searching ? "Searching…" : loaded.items.length === 0 ? emptyText : count}
          </p>
          {loaded.items.length > 0 && (
            <div className={searching ? "opacity-60" : undefined}>
              <OrdersTable items={loaded.items} timeZone={loaded.page.event.timeZone} caption={`Orders for ${loaded.page.event.title || "this event"}`} />
              <OrderCards items={loaded.items} timeZone={loaded.page.event.timeZone} caption={`Orders for ${loaded.page.event.title || "this event"}`} />
            </div>
          )}
          {loaded.nextCursor && (
            <div className="mt-6 flex flex-col items-start gap-3">
              <Button variant="outline" size="lg" busy={more.busy} onClick={() => void showMore()}>
                {more.busy ? "Loading…" : "Show more"}
              </Button>
              {more.error && (
                <Notice tone="danger" role="alert">
                  {more.error}
                </Notice>
              )}
            </div>
          )}
          {expired && (
            <p className="mt-8 text-xs text-muted">Buyer details are removed {DETAILS_VISIBLE_MONTHS} months after the event.</p>
          )}
        </div>
      )}
    </>
  );
}

const headClass = "eyebrow pr-4 pb-3 text-left align-bottom text-muted last:pr-0";
const cellClass = "py-3 pr-4 align-top last:pr-0";

function OrdersTable({ items, timeZone, caption }: { items: EventOrderRow[]; timeZone: string; caption: string }) {
  return (
    <div className="hidden lg:block">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {["Name", "Email", "Tickets", "Paid", "Placed", "Status"].map((label) => (
              <th key={label} scope="col" className={headClass}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((order) => (
            <tr key={order.reference} className="border-t border-surface-border">
              <th scope="row" className={`${cellClass} text-left font-semibold break-words`}>
                {order.buyerName ?? NONE}
              </th>
              <td className={`${cellClass} break-all`}>{order.buyerEmail ?? NONE}</td>
              <td className={cellClass}>{orderTicketsText(order)}</td>
              <td className={`${cellClass} whitespace-nowrap tabular-nums`}>{orderPaidText(order)}</td>
              <td className={cellClass}>{orderPlacedText(order.placedAt, timeZone)}</td>
              <td className={cellClass}>{orderStatusText(order)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCards({ items, timeZone, caption }: { items: EventOrderRow[]; timeZone: string; caption: string }) {
  return (
    <ul aria-label={caption} className="lg:hidden">
      {items.map((order) => (
        <li key={order.reference} className="border-t border-surface-border py-4">
          <p className="text-base font-semibold break-words">{order.buyerName ?? NONE}</p>
          <p className="text-sm break-all text-muted">{order.buyerEmail ?? NONE}</p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Tickets</dt>
            <dd className="text-right">{orderTicketsText(order)}</dd>
            <dt className="text-muted">Paid</dt>
            <dd className="text-right tabular-nums">{orderPaidText(order)}</dd>
            <dt className="text-muted">Placed</dt>
            <dd className="text-right">{orderPlacedText(order.placedAt, timeZone)}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="text-right">{orderStatusText(order)}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
