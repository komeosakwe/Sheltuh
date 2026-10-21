"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { navLinkClass } from "@/components/AuthNavLinks";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { useIsDesktop } from "@/components/ui/useIsDesktop";
import { DotsLoader } from "@/components/brand/DotsMark";
import { ApiError, type GetToken } from "@/lib/api/client";
import { createCheckoutSession } from "@/lib/api/orders";
import { createSeatedCheckout, getSeatAvailability, seatErrorDetails } from "@/lib/api/seating";
import { MAX_FREE_TICKETS_PER_ORDER, SEAT_HOLD } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { formatAud, formatEventDateShort, formatEventTime } from "@/lib/format";
import { getTicketBuyerTotalCents } from "@/lib/pricing";
import { unavailablePositions } from "@/lib/seating/availability";
import { formatSeatLine, speakSeatLine } from "@/lib/seating/format";
import {
  findBestSeats,
  generalAdmissionTiers,
  seatBounds,
  seatedTiers,
  seatOrderSummary,
  sortSeats,
  tierTreatments,
} from "@/lib/seating/selection";
import { flattenSeats, MAX_SEATS_PER_ORDER, type FlatSeat, type SeatKind, type SeatMapTemplate } from "@/lib/seating/template";
import { freeTicketsIn, ownLimit, ownLimitHint, type Quantities } from "@/lib/ticket-limits";
import { getTrackingRef } from "@/lib/tracking-ref";
import type { SheltuhEvent, TicketType } from "@/lib/types";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import FindSeats, { type FindSeatsOutcome } from "./FindSeats";
import GeneralAdmissionSteppers from "./GeneralAdmissionSteppers";
import SeatDialog from "./SeatDialog";
import { patternIdsFor, SeatPatternDefs } from "./SeatGlyph";
import { SeatLegendFull, SeatLegendStrip } from "./SeatLegend";
import SeatLine from "./SeatLine";
import SeatList, { seatPriceText } from "./SeatList";
import SeatMap, { type SeatMapControl } from "./SeatMap";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Availability is polled this often while the page is visible (docs/SEATING_PLAN.md). */
export const AVAILABILITY_POLL_MS = 10_000;
/** After this many failed polls in a row, say availability may be out of date (§5.2). */
const STALE_AFTER_FAILURES = 3;

export type SeatPickerMode = "live" | "demo" | "preview";

export interface SeatPickerMap {
  version: number;
  seatCount: number;
  template: SeatMapTemplate;
}

// The Map/List tab, remembered for the session (UI state only, §5.2).
type SeatTab = "map" | "list";
const TAB_KEY = "sheltuh:seat-tab";
const tabListeners = new Set<() => void>();
function readTab(): SeatTab {
  try {
    return window.sessionStorage.getItem(TAB_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}
function writeTab(tab: SeatTab) {
  try {
    window.sessionStorage.setItem(TAB_KEY, tab);
  } catch {
    // Storage unavailable (private mode): the tab still changes for this page.
  }
  tabListeners.forEach((listener) => listener());
}
function subscribeTab(listener: () => void) {
  tabListeners.add(listener);
  return () => tabListeners.delete(listener);
}

const KIND_COPY: Record<Exclude<SeatKind, "standard">, { title: string; body: string }> = {
  wheelchair: {
    title: "Wheelchair space",
    body: "This space is kept for a wheelchair user. Book it only if you or someone in your group needs it.",
  },
  companion: {
    title: "Companion seat",
    body: "This seat is next to a wheelchair space, for someone going with a wheelchair user. Book it only if that’s you.",
  },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Stalls · Row F · Seat 12, Stalls · Row F · Seat 13" for notices. */
const seatList = (seats: FlatSeat[]) => sortSeats(seats).map(formatSeatLine).join(", ");

export interface SeatPickerProps {
  event: SheltuhEvent;
  map: SeatPickerMap;
  /** `live`: checkout and availability polling; `demo`: the local sample (checkout off); `preview`: what buyers see, checkout off. */
  mode: SeatPickerMode;
  /** Seat positions unavailable when the page opened (sold, held or blocked). */
  initialUnavailable: number[];
  /** Live and preview of a saved map: poll availability (with a token before the event is published). */
  poll?: { getToken?: GetToken } | false;
  /** The availability (or a checkout) was for another map version: reload the map. */
  onMapStale?: () => void;
  /** Where "back" goes (default: the event page). */
  backHref?: string;
}

/**
 * The seat page (docs/design/seating.md §3.1, §3.2, §5.2–§5.11): the map and
 * the equivalent list, legend, Find seats, the summary with all-inclusive
 * prices and the total (lib/fees.ts via lib/seating/selection.ts), and
 * checkout. Nothing is held while choosing: pressing Checkout holds the
 * seats (SEAT_HOLD.stripeMinutes is what buyers are told).
 */
export default function SeatPicker({
  event,
  map,
  mode,
  initialUnavailable,
  poll = false,
  onMapStale,
  backHref = `/events/${event.slug}`,
}: SeatPickerProps) {
  const idPrefix = useId();
  const patterns = useMemo(() => patternIdsFor(`seat${idPrefix}`), [idPrefix]);
  const template = map.template;
  const seats = useMemo(() => flattenSeats(template), [template]);
  const byId = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const tiers = useMemo(() => seatedTiers(event.ticketTypes, template), [event.ticketTypes, template]);
  const tierById = useMemo(() => new Map(event.ticketTypes.map((tier) => [tier.id, tier])), [event.ticketTypes]);
  const treatments = useMemo(() => tierTreatments(tiers), [tiers]);
  const gaTiers = useMemo(() => generalAdmissionTiers(event.ticketTypes, template), [event.ticketTypes, template]);
  const mixed = gaTiers.length > 0;

  const [unavailable, setUnavailable] = useState<ReadonlySet<number>>(() => new Set(initialUnavailable));
  const isUnavailable = useCallback(
    (seat: FlatSeat) => seat.blocked || unavailable.has(seat.position) || !tierById.has(seat.ticketTypeId),
    [unavailable, tierById],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  // A new map version (an admin replaced it): drop seats that no longer exist.
  const selectedSeats = useMemo(
    () => sortSeats(selectedIds.map((id) => byId.get(id)).filter((seat): seat is FlatSeat => seat !== undefined)),
    [selectedIds, byId],
  );
  const [gaQuantities, setGaQuantities] = useState<Quantities>({});

  const tab = useSyncExternalStore(subscribeTab, readTab, () => "map" as SeatTab);
  const [announcement, setAnnouncement] = useState("");
  /** The one inline message in the summary (limit, taken by the poll, Find seats with Undo): cleared on the next change. */
  const [inline, setInline] = useState<{ text: string; undo?: string[] } | null>(null);
  const [pendingKind, setPendingKind] = useState<FlatSeat | null>(null);
  const confirmedKinds = useRef(new Set<SeatKind>());
  const [findOpen, setFindOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Checkout.
  const auth = useOptionalAuth();
  const accountEmail = auth?.status === "signed-in" ? auth.email : undefined;
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const buyerEmail = typedEmail ?? accountEmail ?? "";
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<{ text: string; n: number } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const mapControl = useRef<SeatMapControl | null>(null);
  const listHeaderRef = useRef<HTMLButtonElement>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement>(null);
  const sheetHeadingRef = useRef<HTMLHeadingElement>(null);
  const sheetToggleRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ kind: "remove"; index: number } | { kind: "list" } | { kind: "email" } | { kind: "sheet" } | null>(null);

  // What can happen here.
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();
  const readOnly = ended;
  const availableCount = useMemo(() => seats.filter((seat) => !isUnavailable(seat)).length, [seats, isUnavailable]);
  const everySeatTaken = availableCount === 0 && selectedSeats.length === 0;
  const canCheckout = mode === "live" && Boolean(event.organiserId) && !readOnly;

  // Totals (lib/fees.ts only).
  const gaLines = gaTiers.map((ticket) => ({ ticket, quantity: gaQuantities[ticket.id] ?? 0 })).filter((line) => line.quantity > 0);
  const totals = seatOrderSummary(selectedSeats, tierById, gaLines);
  const gaCount = gaLines.reduce((n, line) => n + line.quantity, 0);
  const hasAnything = selectedSeats.length > 0 || gaCount > 0;
  const freeSeats = selectedSeats.filter((seat) => (tierById.get(seat.ticketTypeId)?.priceCents ?? 0) === 0).length;
  const freeTickets = freeSeats + freeTicketsIn(gaTiers, gaQuantities);
  const freeBooking = hasAnything ? totals.totalCents === 0 : [...tiers, ...gaTiers].every((tier) => tier.priceCents === 0);
  const needsEmail = canCheckout && hasAnything && totals.totalCents === 0;
  const onSaleTiers = tiers.filter((tier) => !tier.soldOut);
  const fromCents = tiers.length ? Math.min(...(onSaleTiers.length ? onSaleTiers : tiers).map(getTicketBuyerTotalCents)) : null;
  // The summary exists in one place only (the desktop card, or the phone sheet), so its ids and focus targets are unique.
  const isDesktop = useIsDesktop();

  const announce = useCallback((text: string) => {
    // The same words again must still be read out: a trailing no-break space changes the text.
    setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text));
  }, []);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Polling (live, or an admin's preview of a saved map), every 10 seconds while visible.
  const pollToken = poll ? poll.getToken : undefined;
  const pollAvailability = useCallback(async () => {
    try {
      const result = await getSeatAvailability(event.id, { getToken: pollToken });
      if (result.version !== map.version) {
        onMapStale?.();
        return;
      }
      const positions = unavailablePositions(result.unavailable, map.seatCount);
      if (!positions) throw new Error("Unreadable availability.");
      const next = new Set(positions);
      setUnavailable(next);
      setFailures(0);
      setLastUpdated(formatEventTime(new Date().toISOString()));
      // Seats taken while choosing leave the selection, and say so.
      const taken = selectedIdsRef.current.map((id) => byId.get(id)).filter((seat): seat is FlatSeat => !!seat && next.has(seat.position));
      if (taken.length > 0) {
        const ids = new Set(taken.map((seat) => seat.id));
        setSelectedIds((prev) => prev.filter((id) => !ids.has(id)));
        const text =
          taken.length === 1
            ? `${speakSeatLine(taken[0])} was just taken and has been removed from your seats.`
            : `${taken.map(speakSeatLine).join("; ")} were just taken and have been removed from your seats.`;
        announce(text);
        setInline({ text });
      }
    } catch {
      setFailures((n) => n + 1);
    }
  }, [event.id, pollToken, map.version, map.seatCount, byId, onMapStale, announce]);
  useVisibleInterval(pollAvailability, AVAILABILITY_POLL_MS, { enabled: Boolean(poll) && !readOnly });

  // Focus moves that wait for the render they depend on.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "list") listHeaderRef.current?.focus();
    else if (target.kind === "email") emailRef.current?.focus();
    else if (target.kind === "sheet") sheetHeadingRef.current?.focus();
    else {
      const buttons = selectedSeats.map((seat) => removeRefs.current.get(seat.id)).filter((b): b is HTMLButtonElement => !!b);
      const next = buttons[Math.min(target.index, buttons.length - 1)];
      (next ?? (isDesktop ? summaryHeadingRef.current : sheetHeadingRef.current))?.focus();
    }
  });

  function totalWords(seatsAfter: FlatSeat[], ga = gaLines): string {
    const total = seatOrderSummary(seatsAfter, tierById, ga).totalCents;
    return `${plural(seatsAfter.length, "seat", "seats")}, total ${formatAud(total)}${total > 0 ? " incl. booking fees" : ""}.`;
  }

  function changeSelection(next: string[]) {
    setSelectedIds(next);
    setInline(null);
    setCheckoutError(null);
  }

  /** Add a seat (after any confirmation), or say why not. */
  function addSeat(seat: FlatSeat, confirmed = false) {
    if (selectedIds.length >= MAX_SEATS_PER_ORDER) {
      const text = `That’s ${MAX_SEATS_PER_ORDER} seats, the most for one order. Remove one to choose another.`;
      announce(text);
      setInline({ text });
      return;
    }
    const tier = tierById.get(seat.ticketTypeId);
    if (tier && tier.priceCents === 0 && freeTickets >= MAX_FREE_TICKETS_PER_ORDER) {
      const text = `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking.`;
      announce(text);
      setInline({ text });
      return;
    }
    if (seat.kind !== "standard" && !confirmed && !confirmedKinds.current.has(seat.kind)) {
      setPendingKind(seat);
      return;
    }
    const next = [...selectedIds, seat.id];
    changeSelection(next);
    const after = sortSeats(next.map((id) => byId.get(id)).filter((s): s is FlatSeat => !!s));
    announce(`Added ${speakSeatLine(seat)}, ${tier && tier.priceCents === 0 ? "Free" : formatAud(tier ? getTicketBuyerTotalCents(tier) : 0)}. ${totalWords(after)}`);
  }

  function removeSeat(seat: FlatSeat) {
    const next = selectedIds.filter((id) => id !== seat.id);
    changeSelection(next);
    const after = sortSeats(next.map((id) => byId.get(id)).filter((s): s is FlatSeat => !!s));
    announce(`Removed ${speakSeatLine(seat)}. ${totalWords(after)}`);
  }

  function toggleSeat(seat: FlatSeat) {
    if (readOnly || sentTo !== null) return;
    if (selected.has(seat.id)) removeSeat(seat);
    else if (!isUnavailable(seat)) addSeat(seat);
  }

  function confirmKind() {
    const seat = pendingKind;
    if (!seat) return;
    confirmedKinds.current.add(seat.kind);
    setPendingKind(null);
    addSeat(seat, true);
  }

  function find(count: number, ticketTypeId: string | undefined): FindSeatsOutcome {
    const found = findBestSeats(template, seats, {
      count,
      ticketTypeId,
      isUnavailable: (position) => {
        const seat = seats[position];
        return !seat || isUnavailable(seat);
      },
    });
    if (!found) return "none";
    // Free seats still count towards the free-ticket cap.
    const freeFound = found.filter((seat) => (tierById.get(seat.ticketTypeId)?.priceCents ?? 0) === 0).length;
    if (freeFound + freeTicketsIn(gaTiers, gaQuantities) > MAX_FREE_TICKETS_PER_ORDER) return "none";
    const previous = selectedIds;
    setSelectedIds(found.map((seat) => seat.id));
    setCheckoutError(null);
    const sorted = sortSeats(found);
    const first = sorted[0];
    const where = [first.section, ...(first.row ? [`Row ${first.row}`] : [])].join(", ");
    const numbers = sorted.map((seat) => seat.seat);
    const seatsWords =
      numbers.length === 1 ? `Seat ${numbers[0]}` : `Seats ${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
    const text = `Found ${plural(count, "seat", "seats together")}: ${where}, ${seatsWords}. They’re now your seats.`;
    announce(text);
    setInline({ text, undo: previous });
    setFindOpen(false);
    const bounds = seatBounds(found);
    if (bounds) mapControl.current?.fitBounds(bounds, 300);
    return "found";
  }

  function undoFind(previous: string[]) {
    changeSelection(previous);
    announce(`Back to your previous seats. ${totalWords(sortSeats(previous.map((id) => byId.get(id)).filter((s): s is FlatSeat => !!s)))}`);
  }

  /** General admission steppers: the ticket selector's limits, plus the free cap shared with free seats. */
  function gaCapFor(ticket: TicketType, quantities: Quantities = gaQuantities): { cap: number; reason: string } {
    const own = ownLimit(ticket);
    if (ticket.priceCents > 0) return { cap: own, reason: ownLimitHint(ticket) };
    const room = MAX_FREE_TICKETS_PER_ORDER - (freeSeats + freeTicketsIn(gaTiers, quantities) - (quantities[ticket.id] ?? 0));
    return room < own ? { cap: Math.max(room, 0), reason: `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking.` } : { cap: own, reason: ownLimitHint(ticket) };
  }

  function setGaQuantity(ticket: TicketType, value: number) {
    if (readOnly || sentTo !== null) return;
    const current = gaQuantities[ticket.id] ?? 0;
    const { cap, reason } = gaCapFor(ticket);
    const clamped = Math.max(0, Math.min(value, cap));
    if (clamped === current) {
      if (value > current) announce(`${ticket.name}: ${current}. ${reason}`);
      return;
    }
    const next = { ...gaQuantities, [ticket.id]: clamped };
    setGaQuantities(next);
    setInline(null);
    setCheckoutError(null);
    const lines = gaTiers.map((t) => ({ ticket: t, quantity: next[t.id] ?? 0 })).filter((line) => line.quantity > 0);
    const total = seatOrderSummary(selectedSeats, tierById, lines).totalCents;
    announce(`${ticket.name}: ${clamped}. Total ${formatAud(total)}${total > 0 ? " incl. booking fees" : ""}.`);
  }

  function selectTab(next: SeatTab, focusPanel = false) {
    writeTab(next);
    if (focusPanel && next === "list") pendingFocus.current = { kind: "list" };
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: SeatTab = tab === "map" ? "list" : "map";
    selectTab(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  }

  function onSummaryRemove(seat: FlatSeat) {
    const index = selectedSeats.findIndex((s) => s.id === seat.id);
    pendingFocus.current = { kind: "remove", index };
    removeSeat(seat);
  }

  function toggleSheet() {
    if (sheetOpen) {
      setSheetOpen(false);
    } else {
      setSheetOpen(true);
      pendingFocus.current = { kind: "sheet" };
    }
  }

  function takenAtCheckout(ids: string[]) {
    const gone = ids.map((id) => byId.get(id)).filter((seat): seat is FlatSeat => !!seat);
    const goneIds = new Set(gone.map((seat) => seat.id));
    const all = selectedIds.length > 0 && selectedIds.every((id) => goneIds.has(id));
    setSelectedIds((prev) => prev.filter((id) => !goneIds.has(id)));
    setUnavailable((prev) => new Set([...prev, ...gone.map((seat) => seat.position)]));
    const lines = seatList(gone);
    return all
      ? `Your seats were taken while you were choosing: ${lines}. Choose other seats, then press Checkout again.`
      : `Some seats were taken while you were choosing: ${lines}. We’ve removed them. Choose other seats, then press Checkout again.`;
  }

  async function checkout() {
    if (!canCheckout || !hasAnything) return;
    setCheckoutError(null);
    setEmailError(null);
    if (needsEmail && !EMAIL_REGEX.test(buyerEmail.trim())) {
      setEmailError("Enter the email address to send your tickets to.");
      if (!sheetOpen) setSheetOpen(true);
      pendingFocus.current = { kind: "email" };
      return;
    }
    setBusy(true);
    const lineItems = gaLines.map((line) => ({ ticketTypeId: line.ticket.id, quantity: line.quantity }));
    const email = needsEmail ? buyerEmail.trim() : accountEmail;
    const getToken = needsEmail && auth?.status === "signed-in" ? auth.getAccessToken : undefined;
    try {
      const result =
        selectedIds.length > 0
          ? await createSeatedCheckout(
              event.id,
              {
                seats: { mapVersion: map.version, seatIds: selectedIds },
                lineItems,
                ...(email ? { buyerEmail: email } : {}),
                ...(getTrackingRef(event.id) ? { trackingCode: getTrackingRef(event.id) } : {}),
              },
              getToken,
            )
          : await createCheckoutSession(event.id, lineItems, email, getTrackingRef(event.id), getToken);
      if ("url" in result) {
        // No setBusy(false): the page is navigating away, and re-enabling Checkout would invite a double press.
        window.location.assign(result.url);
        return;
      }
      setSentTo(email ?? "");
      setBusy(false);
    } catch (err) {
      setBusy(false);
      const details = seatErrorDetails(err);
      let text: string;
      if (err instanceof ApiError && err.status === 409 && details?.code === "seats_unavailable" && details.seatIds?.length) {
        text = takenAtCheckout(details.seatIds);
      } else if (details?.code === "seat_map_changed") {
        text = "The seat map has just been updated. Check your seats, then press Checkout again.";
        onMapStale?.();
      } else if (err instanceof ApiError && err.status === 429) {
        text = "A lot of people are checking out for this event right now. Try again in a minute.";
      } else if (err instanceof ApiError && err.fieldErrors?.buyerEmail) {
        setEmailError(err.fieldErrors.buyerEmail);
        if (!sheetOpen) setSheetOpen(true);
        pendingFocus.current = { kind: "email" };
        return;
      } else if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        text = Object.values(err.fieldErrors).filter(Boolean).join(" ") || err.message;
      } else {
        text = err instanceof Error ? err.message : "Couldn’t start checkout. Try again.";
      }
      setCheckoutError((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    }
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  const holdCopy = freeBooking
    ? auth?.status === "signed-in"
      ? "Pressing Get free tickets books these seats straight away."
      : "We’ll email you a link to confirm. Your seats are only held once you confirm, if they’re still free."
    : `Seats aren’t held while you choose. Pressing Checkout holds them for you while you pay on Stripe. You’ll have ${SEAT_HOLD.stripeMinutes} minutes; if you don’t finish, they’re released.`;

  const checkoutLabel = busy ? (freeBooking ? "Booking…" : "Holding your seats…") : freeBooking ? "Get free tickets" : "Checkout";

  function checkoutButton(className: string) {
    if (readOnly) return null;
    if (everySeatTaken && gaTiers.every((t) => t.soldOut)) return null;
    if (mode === "preview") {
      return (
        <button type="button" disabled aria-disabled="true" className={`btn btn-lg ${className}`}>
          Checkout is off in preview
        </button>
      );
    }
    if (!canCheckout) {
      return (
        <button type="button" disabled aria-disabled="true" className={`btn btn-lg ${className}`}>
          Checkout unavailable in this demo
        </button>
      );
    }
    if (sentTo !== null) return null;
    return (
      <Button variant="solid" size="lg" busy={busy} disabled={!hasAnything} onClick={checkout} className={className}>
        {checkoutLabel}
      </Button>
    );
  }

  const errorNotice = checkoutError && (
    <Notice key={checkoutError.n} tone="danger" role="alert">
      {checkoutError.text}
    </Notice>
  );

  function summaryBody(headingRef: typeof summaryHeadingRef) {
    return (
      <div className="flex flex-col gap-4">
        <h2 ref={headingRef} tabIndex={-1} className="eyebrow text-muted outline-offset-2">
          Your seats
        </h2>
        {selectedSeats.length === 0 ? (
          <p className="text-sm text-muted">
            {everySeatTaken ? "Every seat is taken." : `No seats chosen yet. Choose up to ${MAX_SEATS_PER_ORDER} seats.`}
          </p>
        ) : (
          <ul className="flex flex-col">
            {selectedSeats.map((seat) => {
              const tier = tierById.get(seat.ticketTypeId);
              const kindWords = seat.kind === "wheelchair" ? " · Wheelchair space" : seat.kind === "companion" ? " · Companion seat" : "";
              return (
                <li key={seat.id} className="flex items-center gap-3 border-t border-surface-border py-2 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <SeatLine seat={seat} className="block text-sm font-semibold" />
                    <p className="meta text-muted">
                      {tier?.name}
                      {kindWords}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {tier && tier.priceCents === 0 ? "Free" : formatAud(tier ? getTicketBuyerTotalCents(tier) : 0)}
                  </p>
                  {!readOnly && sentTo === null && (
                    <button
                      ref={(node) => {
                        if (node) removeRefs.current.set(seat.id, node);
                        else removeRefs.current.delete(seat.id);
                      }}
                      type="button"
                      aria-label={`Remove ${speakSeatLine(seat)}`}
                      onClick={() => onSummaryRemove(seat)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-surface"
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {everySeatTaken && (
          <Link href={`/events/${event.slug}#tickets`} className="inline-flex min-h-11 w-fit items-center text-sm font-semibold underline underline-offset-4">
            Join the waitlist
          </Link>
        )}

        {inline && (
          <div className="flex flex-col gap-1">
            <Notice>{inline.text}</Notice>
            {inline.undo && (
              <button
                type="button"
                onClick={() => inline.undo && undoFind(inline.undo)}
                className="min-h-11 w-fit text-sm font-semibold underline underline-offset-4"
              >
                Undo
              </button>
            )}
          </div>
        )}

        {mixed && !readOnly && (
          <GeneralAdmissionSteppers
            tiers={gaTiers}
            quantities={gaQuantities}
            capFor={(ticket) => gaCapFor(ticket)}
            onChange={setGaQuantity}
            idPrefix={idPrefix}
          />
        )}

        <dl className="flex flex-col gap-2 border-t border-foreground pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Tickets</dt>
            <dd className="tabular-nums">{formatAud(totals.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Booking fees</dt>
            <dd className="tabular-nums">{formatAud(totals.buyerFeeCents)}</dd>
          </div>
          {/* The total is the largest number on the page. */}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-foreground pt-3">
            <dt className="text-lg leading-6 font-bold">Total</dt>
            <dd className="text-xl leading-7 font-bold tabular-nums">{formatAud(totals.totalCents)}</dd>
          </div>
        </dl>
        <p className="meta -mt-2 text-muted">
          {plural(selectedSeats.length, "seat", "seats")}
          {gaCount > 0 && ` + ${gaCount} general admission`}
        </p>

        {sentTo !== null && (
          <div className="flex flex-col gap-2">
            <h3 className="font-heading text-xl">Check your inbox</h3>
            <p role="status" className="text-sm">
              We&rsquo;ve emailed a link to <span className="font-semibold break-all">{sentTo}</span>. Open it and press
              Confirm to get your tickets. The link works for 24 hours.
            </p>
            <p className="text-xs text-muted">Your seats are only held once you confirm, if they&rsquo;re still free.</p>
          </div>
        )}

        {needsEmail && sentTo === null && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-email`} className="eyebrow text-muted">
              Email for your tickets
            </label>
            <input
              ref={emailRef}
              id={`${idPrefix}-email`}
              type="email"
              autoComplete="email"
              required
              value={buyerEmail}
              onChange={(event) => setTypedEmail(event.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${idPrefix}-email-error` : undefined}
              className="min-h-12 px-3 py-2 text-base"
            />
            {emailError && (
              <p id={`${idPrefix}-email-error`} role="alert" className="text-sm text-danger">
                {emailError}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  const holdAndTerms =
    !readOnly && sentTo === null ? (
      <div className="flex flex-col gap-2">
        {mode === "live" ? (
          <>
            <p className="text-xs text-muted">{holdCopy}</p>
            <p className="text-xs text-muted">
              By booking you agree to the{" "}
              <Link href="/purchase-terms" className="text-foreground underline underline-offset-2">
                Purchase Terms
              </Link>
              . See our{" "}
              <Link href="/privacy" className="text-foreground underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
          </>
        ) : mode === "demo" ? (
          <p className="text-xs text-muted">
            This is a local prototype. No payment information is collected and no seats are held
            {hasAnything ? " — the total above is a preview only." : "."}
          </p>
        ) : (
          <p className="text-xs text-muted">This is a preview: nothing can be booked from it.</p>
        )}
      </div>
    ) : null;

  const stale =
    poll && failures >= STALE_AFTER_FAILURES ? (
      <p className="meta px-4 py-2 text-muted sm:px-8 lg:px-0">
        {lastUpdated ? `Availability last updated ${lastUpdated}.` : "Availability couldn’t be updated."} Seats may already be taken.
      </p>
    ) : null;

  const listAndMap = (
    <>
      <div
        role="tabpanel"
        id={`${idPrefix}-panel-map`}
        aria-labelledby={`${idPrefix}-tab-map`}
        tabIndex={-1}
        hidden={tab !== "map"}
        className="relative h-full"
      >
        <a
          href={`#${idPrefix}-panel-list`}
          onClick={(e) => {
            e.preventDefault();
            selectTab("list", true);
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:rounded-control focus:border focus:border-foreground focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
        >
          Choose seats from a list
        </a>
        {tab === "map" && (
          <SeatMap
            template={template}
            seats={seats}
            venueName={event.venueName}
            isUnavailable={isUnavailable}
            selected={selected}
            treatments={treatments}
            tierById={tierById}
            patterns={patterns}
            interactive={!readOnly && sentTo === null}
            onSeat={toggleSeat}
            onSectionShown={(label, count) => announce(`Showing ${label}. ${plural(count, "seat", "seats")} available.`)}
            controlRef={mapControl}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-panel-list`}
        aria-labelledby={`${idPrefix}-tab-list`}
        tabIndex={-1}
        hidden={tab !== "list"}
        className="h-full overflow-y-auto"
      >
        {tab === "list" && (
          <SeatList
            template={template}
            seats={seats}
            isUnavailable={isUnavailable}
            selected={selected}
            tiers={tiers}
            treatments={treatments}
            patterns={patterns}
            interactive={!readOnly && sentTo === null}
            onToggle={toggleSeat}
            firstHeaderRef={listHeaderRef}
          />
        )}
      </div>
    </>
  );

  const dateLine = `${formatEventDateShort(event.startsAt)}, ${formatEventTime(event.startsAt)} · ${event.venueName}`;

  return (
    <div className="relative lg:mx-auto lg:max-w-7xl lg:px-8 lg:pt-6 lg:pb-16">
      <SeatPatternDefs ids={patterns} />
      {mode === "preview" && (
        <div className="flex items-center gap-2 border-b border-foreground px-4 py-2 sm:px-8 lg:mb-4 lg:border-0 lg:px-0">
          <span className="eyebrow">Preview · what buyers see</span>
          <span className="eyebrow rounded-badge border border-foreground px-2 py-0.5">Preview</span>
        </div>
      )}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-8">
        {/* Phones and tablets: a viewport-height tool, the seat bar at its foot (§3.1). */}
        <div className="flex h-[calc(100dvh-var(--header-h))] min-h-[29rem] flex-col lg:block lg:h-auto lg:min-h-0">
          <div className="flex min-h-12 items-center gap-3 border-b border-foreground px-4 sm:px-8 lg:flex-col lg:items-start lg:gap-1 lg:border-0 lg:px-0 lg:pb-4">
            <Link
              href={backHref}
              aria-label={`Back to ${event.title}`}
              className="flex size-11 shrink-0 items-center justify-center rounded-control hover:bg-surface lg:hidden"
            >
              <span aria-hidden="true">&larr;</span>
            </Link>
            <Link href={backHref} className="eyebrow hidden min-h-11 items-center underline underline-offset-4 lg:inline-flex">
              &larr; {event.title}
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="font-heading truncate text-xl leading-6">Choose seats</h1>
              <p className="meta hidden truncate text-muted sm:block">{dateLine}</p>
            </div>
            {!readOnly && (
              <button type="button" onClick={() => setFindOpen(true)} className="btn btn-outline btn-sm min-h-11 shrink-0 lg:hidden">
                Find seats
              </button>
            )}
          </div>

          <div role="tablist" aria-label="Seat view" className="flex gap-2 border-b border-surface-border px-2 sm:px-6 lg:px-0">
            {(["map", "list"] as const).map((name) => (
              <button
                key={name}
                id={`${idPrefix}-tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls={`${idPrefix}-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => selectTab(name)}
                onKeyDown={onTabKey}
                className={`${navLinkClass} inline-flex min-h-11 items-center`}
              >
                {name === "map" ? "Map" : "List"}
              </button>
            ))}
          </div>

          <div className="lg:hidden">
            <SeatLegendStrip tiers={tiers} treatments={treatments} patterns={patterns} mixed={mixed} />
          </div>
          {stale}
          {readOnly && (
            <div className="px-4 py-3 sm:px-8 lg:px-0">
              <Notice>
                Ticket sales for this event have ended.{" "}
                <Link href={backHref} className="underline underline-offset-2">
                  Back to the event
                </Link>
              </Notice>
            </div>
          )}

          <div className="relative min-h-60 flex-1 lg:mt-4 lg:h-[calc(100dvh-var(--header-h)-10rem)] lg:min-h-[32rem] lg:flex-none lg:border lg:border-foreground">
            {listAndMap}
          </div>

          {/* The phone seat bar (§5.10): white, in flow at the foot of the tool. */}
          {!readOnly && (
            <div data-seat-bar className="relative border-t border-foreground bg-card lg:hidden">
              {sheetOpen && !isDesktop && (
                <div
                  id={`${idPrefix}-sheet`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSheetOpen(false);
                      sheetToggleRef.current?.focus();
                    }
                  }}
                  className="seat-sheet absolute inset-x-0 bottom-full z-20 flex max-h-[70dvh] flex-col gap-4 overflow-y-auto rounded-t-card border-x border-t border-foreground bg-card p-4 sm:px-8"
                >
                  {summaryBody(sheetHeadingRef)}
                  {holdAndTerms}
                </div>
              )}
              <div className="flex min-h-[var(--seatbar-h)] items-center gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-8">
                <button
                  ref={sheetToggleRef}
                  type="button"
                  aria-expanded={sheetOpen}
                  aria-controls={`${idPrefix}-sheet`}
                  onClick={toggleSheet}
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start text-left"
                >
                  <span className="eyebrow flex items-center gap-1">
                    {hasAnything ? `${plural(selectedSeats.length, "seat", "seats")}${gaCount ? ` + ${gaCount}` : ""} · Details` : "No seats chosen"}
                    <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-3 ${sheetOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 8l4-4 4 4" />
                    </svg>
                  </span>
                  {hasAnything ? (
                    <span className="text-lg leading-6 font-bold tabular-nums">
                      {formatAud(totals.totalCents)} <span className="text-xs font-normal text-muted">incl. fees</span>
                    </span>
                  ) : (
                    <span className="text-base leading-6 font-semibold tabular-nums">
                      {fromCents === null ? "" : fromCents === 0 ? "Free" : `From ${formatAud(fromCents)}`}{" "}
                      {fromCents !== null && fromCents > 0 && <span className="text-xs font-normal text-muted">incl. booking fee</span>}
                    </span>
                  )}
                </button>
                {!isDesktop && checkoutButton("shrink-0 px-5")}
              </div>
              {errorNotice && !isDesktop && <div className="px-4 pb-3 sm:px-8">{errorNotice}</div>}
            </div>
          )}
        </div>

        {/* Desktop side panel (§3.2): legend, Find seats, then the summary card with Checkout. */}
        <aside className="hidden lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:flex lg:max-h-[calc(100dvh-var(--header-h)-3rem)] lg:flex-col lg:gap-6 lg:self-start lg:overflow-y-auto">
          <SeatLegendFull tiers={tiers} treatments={treatments} patterns={patterns} mixed={mixed} />
          {!readOnly && (
            <section aria-labelledby={`${idPrefix}-find`} className="flex flex-col gap-3 border-t border-foreground pt-4">
              <h2 id={`${idPrefix}-find`} className="eyebrow text-muted">
                Find seats
              </h2>
              <FindSeats tiers={tiers} onFind={find} layout="columns" />
            </section>
          )}
          {isDesktop && (
            <div className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-5">
              {summaryBody(summaryHeadingRef)}
              {checkoutButton("w-full")}
              {errorNotice}
              {holdAndTerms}
            </div>
          )}
        </aside>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <SeatDialog open={findOpen} title="Find seats" onClose={() => setFindOpen(false)}>
        <FindSeats tiers={tiers} onFind={find} />
      </SeatDialog>

      <SeatDialog
        open={pendingKind !== null}
        title={pendingKind && pendingKind.kind !== "standard" ? KIND_COPY[pendingKind.kind].title : ""}
        onClose={() => setPendingKind(null)}
      >
        {pendingKind && pendingKind.kind !== "standard" && (
          <>
            <p className="text-base leading-6">{KIND_COPY[pendingKind.kind].body}</p>
            <p className="text-sm text-muted">
              <SeatLine seat={pendingKind} /> · {seatPriceText(tierById.get(pendingKind.ticketTypeId))}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
              <Button variant="solid" size="lg" onClick={confirmKind} className="w-full sm:w-auto">
                Choose this seat
              </Button>
              <Button variant="outline" size="lg" onClick={() => setPendingKind(null)} className="w-full sm:w-auto">
                Cancel
              </Button>
            </div>
          </>
        )}
      </SeatDialog>
    </div>
  );
}

/** The seat page's loading state (§5.2): the rows in place, the canvas loading. */
export function SeatPickerLoading() {
  return (
    <div className="flex h-[calc(100dvh-var(--header-h))] min-h-[29rem] flex-col lg:mx-auto lg:max-w-7xl lg:px-8 lg:pt-6">
      <div className="flex min-h-12 items-center border-b border-foreground px-4 sm:px-8 lg:border-0 lg:px-0">
        <h1 className="font-heading text-xl leading-6">Choose seats</h1>
      </div>
      <div className="flex min-h-60 flex-1 items-center justify-center bg-surface">
        <DotsLoader announce label="Loading the seat map" />
      </div>
    </div>
  );
}
