"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { useSoftKeyboardOpen } from "@/lib/use-soft-keyboard";
import type { FeedPriceParts } from "@/lib/pricing";

/**
 * What the ticket selector tells the event page's phone buy bar (below lg).
 * `checkout`: something is chosen, so the bar shows the order's total and is
 * a Checkout action beside the panel's own (`onPress` is the selector's own
 * submit, so there's a single checkout path). `status`: a free booking waiting on its emailed link,
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
 * than a third of the screen (`max-h-bar`).
 */
export function GaBuyBar({
  price,
  label,
  className,
}: {
  price: FeedPriceParts;
  /** "Buy tickets", "Free tickets" or "Join waitlist": the link to the tickets when there's no checkout state. */
  label: string;
  className: string;
}) {
  const state = useContext(StateContext);
  const keyboardOpen = useSoftKeyboardOpen();
  const barRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const amountId = `${id}-amount`;
  const noteId = `${id}-note`;
  const shown = state && state.kind !== "choose" ? state : price;
  const busy = state?.kind === "checkout" && state.busy;

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--buybar-measured", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
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
      document.removeEventListener("focusin", keepFocusClear);
      root.style.removeProperty("--buybar-measured");
    };
  }, []);

  // The mockup's button: 12px radius, big Title Case text (the label's own case is the site's "Buy tickets";
  // `capitalize` is only how it's drawn). White on orange is 3.4:1, so the text is 20px bold (large text, 3:1);
  // while busy the button is the grey disabled one and keeps its own colours.
  const actionClass = `h-12 min-h-12 shrink-0 rounded-card px-5 text-xl leading-6 font-bold tracking-normal capitalize sm:px-7 @max-xs:w-full${busy ? "" : " text-paper"}`;
  return (
    <div
      ref={barRef}
      data-buy-bar
      data-surface="ink"
      // Hidden, not removed: the page keeps the bar's height at its end.
      className={`${className} max-h-bar${keyboardOpen ? " invisible" : ""}`}
    >
      <div className="@container min-w-0 flex-1">
        <div className="flex items-center gap-3 @max-xs:flex-col @max-xs:items-stretch @max-xs:gap-2">
          <div className="min-w-0 flex-1">
            {/* Not a live region: the selector's own status announces each change to the total. */}
            <p id={amountId} className="truncate text-2xl leading-7 font-bold tabular-nums">
              {shown.amount}
            </p>
            {shown.note && (
              // Two lines at most; the whole text is also the button's description, so nothing is lost to a screen reader.
              <p id={noteId} className="line-clamp-2 text-base leading-6 text-muted">
                {shown.note}
              </p>
            )}
          </div>
          <span aria-hidden="true" className="h-10 w-px shrink-0 bg-surface-border @max-xs:hidden" />
          {state?.kind === "checkout" ? (
            // A button: it acts (the same submit as the Checkout in the ticket section).
            // Busy, not disabled, while it works, so focus stays on it and a second tap does nothing.
            <Button
              variant="signal"
              size="lg"
              onClick={state.onPress}
              busy={state.busy}
              aria-busy={state.busy || undefined}
              aria-describedby={shown.note ? `${amountId} ${noteId}` : amountId}
              className={actionClass}
            >
              {state.busy ? state.busyLabel : state.label}
            </Button>
          ) : (
            // A link: nothing's chosen yet (or it's sold out). With the selector there it moves focus to
            // the first ticket's "+" and says what to do; without, it just goes to the tickets.
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
              className={buttonClass("signal", "lg", actionClass)}
            >
              {state?.kind === "status" ? state.label : label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
