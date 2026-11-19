"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowRightIcon } from "@/components/home/icons";
import { Button, buttonClass } from "@/components/ui/Button";
import { SoonText } from "@/components/ui/SoonTag";
import { useSoftKeyboardOpen } from "@/lib/use-soft-keyboard";
import { startingPrice, type FeedPriceParts } from "@/lib/pricing";
import type { SoonFields } from "@/lib/soon";

/**
 * What the ticket selector tells the event page's phone buy bar (below lg) and
 * its desktop ticket panel. `checkout`: something is chosen, so the bar shows
 * the order's total and is a Checkout action beside the section's own
 * (`onPress` is the selector's own submit, so there's a single checkout path);
 * the desktop panel never checks out, it shows the total and `ticketCount`,
 * and Review order (`onReview`) takes the buyer to what's left to fill in, or
 * to Checkout. `status`: a free booking waiting on its emailed link,
 * so the bar says so rather than offering to buy again. `choose`: nothing is chosen yet, so the bar
 * keeps the event's "From" price and its link, which (`onPress`) takes the buyer to the first ticket's
 * "+" and says what to do, instead of jumping to a section that's already on screen. Nothing registered
 * (sold out, the demo): the plain link to the tickets.
 */
export type BuyBarState =
  | {
      kind: "checkout";
      /** The order's all-inclusive total, from the same figure as the Order summary. */
      amount: string;
      note: string;
      label: string;
      busy: boolean;
      busyLabel: string;
      onPress: () => void;
      /** Tickets in the order, as people get them (a group of 4 is 4). */
      ticketCount: number;
      /** Focus the first field still to fill in (name, email, an Other amount), else the section's Checkout. */
      onReview: () => void;
    }
  | { kind: "status"; amount: string; note: string; label: string }
  | { kind: "choose"; onPress: () => void };

const StateContext = createContext<BuyBarState | null>(null);
const SetStateContext = createContext<((state: BuyBarState | null) => void) | null>(null);

/**
 * Around the event page's ticket section and its buy bar, so the selector
 * (in the section) can drive the bar (last in the page's grid, where it
 * sticks to the bottom of the screen). The setter has its own context, so the
 * selector doesn't re-render with every state change.
 */
export function BuyBarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BuyBarState | null>(null);
  return (
    <SetStateContext.Provider value={setState}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </SetStateContext.Provider>
  );
}

/** The selector's way to set the bar's state; null outside a provider (then the selector keeps its own Checkout on every screen). */
export function useSetBuyBar(): ((state: BuyBarState | null) => void) | null {
  return useContext(SetStateContext);
}

/**
 * The event page's phone buy bar for a general admission event: the bar itself
 * (its class is the page's, shared with the seated and external bars) and its
 * content. It stays out of sight, but in place, while the on-screen keyboard
 * is up over a text field, so it never covers what's being typed in.
 *
 * Its height is measured (`--buybar-measured` on <html>, which globals.css scroll-padding reads), because
 * it isn't fixed: the note wraps (two lines at most), and below about 360px of screen, or with large text
 * (the container query is in rem), the button goes under the amount at full width. It never takes more
 * than a third of the screen (`max-h-bar`); where it would reach that (a short screen, very large text), the date line
 * gives way and the bar may take up to 40% (`max-h-bar-tall`), so the action is never cut off.
 */
export function GaBuyBar({
  price,
  label,
  dateLine,
  soon,
  className,
}: {
  price: FeedPriceParts;
  /** "Buy tickets", "Free tickets" or "Join waitlist": the link to the tickets when there's no checkout state. */
  label: string;
  /** The event's start in mono under the price ("Thu 19 Nov · 7:00 pm"); none for a draft without a date yet. */
  dateLine?: string;
  /** The event's times, for "🔥 Tomorrow · " before the date line (lib/soon.ts). */
  soon?: SoonFields;
  className: string;
}) {
  const state = useContext(StateContext);
  const keyboardOpen = useSoftKeyboardOpen();
  const barRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const amountId = `${id}-amount`;
  const noteId = `${id}-note`;
  const descriptionId = `${id}-description`;
  // The bar would take a third of the screen or more with its date line: it goes (lowered as it's measured below).
  const [tall, setTall] = useState(false);
  const tallRef = useRef(false);
  const dateHeight = useRef(0);
  // Before a selection: the event's starting price ("From A$32.30", "incl. booking fee"). Once tickets are chosen: the
  // order's total, said to be one ("A$64.60", "Total · incl. booking fee" or "Total · no booking fee"; the same figure
  // as the Order summary's).
  const shown =
    state?.kind === "checkout"
      ? { amount: state.amount, note: `Total · ${lowerFirst(state.note)}` }
      : state?.kind === "status"
        ? state
        : { amount: startingPrice(price.amount), note: price.note };
  // The action's description, in reading order: "Total A$37.60, incl. booking fee"; "From A$32.30, incl. booking fee".
  const description =
    state?.kind === "checkout"
      ? `Total ${state.amount}, ${lowerFirst(state.note)}`
      : shown.note
        ? `${shown.amount}, ${shown.note}`
        : shown.amount;

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty("--buybar-measured", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      // Its height with the date line, whether or not it's shown now (so hiding it can't flip the answer back).
      const date = bar.querySelector<HTMLElement>("[data-bar-date]");
      if (date && !tallRef.current) dateHeight.current = date.getBoundingClientRect().height;
      const natural = bar.scrollHeight + (tallRef.current ? dateHeight.current : 0);
      const next = natural > 0 && natural >= window.innerHeight / 3;
      if (next !== tallRef.current) {
        tallRef.current = next;
        setTall(next);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener("resize", measure);
    // Focus is never left under the bar (WCAG 2.4.11). Browsers don't apply scroll-padding to a focus that lands on
    // something already "in view", though the bar covers it, so a focus that ends up under the bar is scrolled clear
    // (scrollIntoView honours the padding set above). Not while the bar is out of the layout (desktop).
    const keepFocusClear = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || bar.contains(target)) return;
      const barBox = bar.getBoundingClientRect();
      if (barBox.height === 0) return;
      const box = target.getBoundingClientRect();
      if (box.bottom > barBox.top && box.top < barBox.bottom) target.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("focusin", keepFocusClear);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", keepFocusClear);
      root.style.removeProperty("--buybar-measured");
    };
  }, []);

  // The rules' sticky-bar button: Primary at size L (56px), radius 8, flat Signal Orange (#ff4800) with a black label
  // (6.18:1), no gradient or shadow, in sentence case ("Buy tickets →"). While busy it's the grey disabled one.
  const actionClass = "shrink-0 gap-2 px-5 sm:px-7 @max-xs:w-full";
  return (
    <div
      ref={barRef}
      data-buy-bar
      // Hidden, not removed: the page keeps the bar's height at its end.
      className={`${className} ${tall ? "max-h-bar-tall" : "max-h-bar"}${keyboardOpen ? " invisible" : ""}`}
    >
      <div className="@container min-w-0 flex-1">
        <div className="flex items-center gap-3 @max-xs:flex-col @max-xs:items-stretch @max-xs:gap-2">
          <BarPrice
            amount={shown.amount}
            note={shown.note}
            dateLine={dateLine}
            soon={soon}
            hideDate={tall}
            amountId={amountId}
            noteId={noteId}
          />
          <BuyAction state={state} label={label} describedBy={descriptionId} className={actionClass} />
        </div>
      </div>
      {/* Read as the action's description (a hidden element still describes it), never on its own. */}
      <span id={descriptionId} hidden>
        {description}
      </span>
    </div>
  );
}

/**
 * A phone buy bar's left side (the owner's event reference, 13 Nov 2026): the all-inclusive amount at 20px semibold
 * (none for an external event whose organiser gave no price), what it includes beside it (under it where there's no
 * room), and the event's start under that, as written. Not a live region: the selector's own status
 * announces each change to the total. When the event is close, the start line leads with it ("🔥 Tomorrow · Sat 14 Nov ·
 * 5:00 pm", components/ui/SoonTag.tsx), on one line: the date is cut short where it must be, never the label.
 */
export function BarPrice({
  amount,
  note,
  dateLine,
  soon,
  amountId,
  noteId,
  hideDate = false,
}: {
  amount?: string;
  note?: string;
  dateLine?: string;
  soon?: SoonFields;
  /** The bar would be a third of the screen or more with it (GaBuyBar): left out. */
  hideDate?: boolean;
  amountId?: string;
  noteId?: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      {amount && (
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span id={amountId} data-bar-amount="" className="text-xl leading-7 font-semibold tabular-nums">
          {amount}
        </span>
        {note && (
          // Also in the button's description, so nothing is lost to a screen reader.
          <span id={noteId} data-bar-note="" className="body-s line-clamp-2 text-muted">
            {note}
          </span>
        )}
      </p>
      )}
      {dateLine && (
        <p data-bar-date="" className={`mono-s min-w-0 text-muted ${hideDate ? "hidden" : "flex"}`}>
          {soon && <SoonText event={soon} />}
          <span className="min-w-0 truncate">{dateLine}</span>
        </p>
      )}
    </div>
  );
}

/** "Incl. booking fee" → "incl. booking fee", after "Total · " or "Total A$X, ". */
function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The trailing arrow on every buy action (the rules' Buy tickets button): 16px, decorative. */
export function BuyArrow() {
  return <ArrowRightIcon className="size-4 shrink-0" />;
}

/**
 * The bar's (and the desktop ticket panel's) one action, from the selector's state. `checkout`: a button, the same
 * submit as the Checkout in the ticket section, busy (not disabled) while it works, so focus stays on it and a second
 * tap does nothing. Otherwise a link: nothing's chosen yet (or it's sold out); with the selector there it's "Choose
 * tickets", which moves focus to the first ticket's "+" and says what to do, and without, it just goes to the tickets.
 */
function BuyAction({
  state,
  label,
  describedBy,
  className,
}: {
  state: BuyBarState | null;
  label: string;
  describedBy: string;
  className: string;
}) {
  if (state?.kind === "checkout") {
    return (
      <Button
        variant="signal"
        size="lg"
        onClick={state.onPress}
        busy={state.busy}
        aria-busy={state.busy || undefined}
        aria-describedby={describedBy}
        className={className}
      >
        {state.busy ? state.busyLabel : state.label}
        {!state.busy && <BuyArrow />}
      </Button>
    );
  }
  return (
    <a
      href="#tickets"
      onClick={
        state?.kind === "choose"
          ? (event) => {
              event.preventDefault();
              state.onPress();
            }
          : undefined
      }
      // The starting price (or the status) beside it is part of what it does: "From A$32.30 incl. booking fee".
      aria-describedby={describedBy}
      className={buttonClass("signal", "lg", className)}
    >
      {/* With the selector there and nothing chosen it says what's needed first; it never checks out until then. */}
      {state?.kind === "status" ? state.label : state?.kind === "choose" ? CHOOSE_LABEL : label}
      <BuyArrow />
    </a>
  );
}

/** The phone bar's action while the selector waits for a choice: it takes focus to the first ticket type's "+". */
export const CHOOSE_LABEL = "Choose tickets";

/** The heading of the tickets section (#tickets), which the panel's action moves focus to. */
export const TICKETS_HEADING_ID = "tickets-title";

/**
 * Moves focus to the tickets section's heading (focusable, with a visible ring), scrolling it into view: the
 * desktop panel's way to the tickets. Returns whether there was one.
 */
export function focusTicketsHeading(): boolean {
  const heading = document.getElementById(TICKETS_HEADING_ID);
  if (!heading) return false;
  heading.focus();
  heading.scrollIntoView?.({ block: "start" });
  return true;
}

/** "3 ticket types. Set a quantity for each one you want.": said as focus lands on the tickets, where there's a choice. */
export function releasesHint(releases: number): string {
  return `${releases} ticket types. Set a quantity for each one you want.`;
}

/**
 * The ticket panel's price and action from lg (the rules' "image + sticky buy panel"), for a general admission
 * event (and a sold-out one's waitlist). It never checks out: Checkout in the tickets section is the one orange
 * checkout. Before anything is chosen it's the event's all-inclusive "From" price and the orange action ("Buy
 * tickets →"), which moves focus to the tickets section's heading and, with more than one release, says how to
 * choose. Once tickets are chosen (the selector's `checkout` state) it's "Total A$X · N tickets" and an outline
 * Review order, to the first field still to fill in, or to Checkout. Below lg the phone bar does this job, so the
 * page hides this (one orange action per view).
 */
export function GaBuyPanel({ price, label, releases }: { price: FeedPriceParts; label: string; releases: number }) {
  const state = useContext(StateContext);
  const [announcement, setAnnouncement] = useState("");

  function goToTickets(event: MouseEvent<HTMLAnchorElement>) {
    if (!focusTicketsHeading()) return;
    event.preventDefault();
    if (releases > 1) {
      // The same words again must still be read out: a trailing no-break space changes the region's text.
      const hint = releasesHint(releases);
      setAnnouncement((prev) => (prev === hint ? `${hint}\u00a0` : hint));
    }
  }

  return (
    <div data-buy-panel="" className="flex flex-col gap-4">
      {state?.kind === "checkout" ? (
        <>
          <PanelPrice
            amount={`Total ${state.amount} · ${state.ticketCount} ${state.ticketCount === 1 ? "ticket" : "tickets"}`}
            note={state.note}
          />
          <Button variant="outline" size="lg" onClick={state.onReview} className="w-full">
            Review order
          </Button>
        </>
      ) : state?.kind === "status" ? (
        <>
          <PanelPrice amount={state.amount} note={state.note} />
          <a href="#tickets" onClick={goToTickets} className={buttonClass("outline", "lg", "w-full")}>
            {state.label}
          </a>
        </>
      ) : (
        <>
          <PanelPrice amount={price.amount} note={price.note} />
          <a href="#tickets" onClick={goToTickets} className={buttonClass("signal", "lg", "w-full gap-2")}>
            {label}
            <BuyArrow />
          </a>
        </>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** The panel's price line: the amount large and bold, then what it includes ("incl. booking fee"), muted, beside it. */
export function PanelPrice({
  amount,
  note,
  amountId,
  noteId,
}: {
  amount: string;
  note?: string;
  amountId?: string;
  noteId?: string;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      {/* Not a live region: the selector's own status announces each change to the total. */}
      <span id={amountId} className="heading-h2 tabular-nums">
        {amount}
      </span>
      {note && (
        <span id={noteId} className="body-s text-muted">
          {note}
        </span>
      )}
    </p>
  );
}
