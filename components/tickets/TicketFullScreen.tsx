"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import TicketPagerButton from "@/components/tickets/TicketPagerButton";
import { CloseIcon } from "@/components/ui/Sheet";
import { requestScreenWakeLock, type ScreenWakeLock } from "@/lib/check-in/wake-lock";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

interface TicketFullScreenProps {
  open: boolean;
  onClose: () => void;
  /** One full ticket per slide (each a `<FullTicket size="screen">`), in the order shown (seated tickets by seat). */
  tickets: ReactNode[];
  /**
   * Each slide's ticket number in the order's numbering (the email's and the door's), for the bar's "Ticket 2 of 2":
   * slides sorted by seat needn't be in that order. Left out, slides are numbered as they come.
   */
  numbers?: readonly number[];
  /** The slide to open on (0-based). */
  start?: number;
  /** What sits under the tickets for the one in view (by slide index): its wallet badges. */
  footer?: (index: number) => ReactNode;
  /** "Send" in the top bar, for the ticket in view (by slide index). Left out (until tickets can be sent), the bar has no Send. */
  onSend?: (index: number) => void;
}

/**
 * The full-screen ticket on phones (Latte's 1120 frames "Show ticket (full
 * screen)" and "2 tickets (swipe)"; behaviour from docs/design/my-ticket.md
 * §5.12): a black screen with a top bar (✕, "TICKET 1 of 2", Send), the
 * ticket large for scanning, pager dots, and the wallet badges for the
 * ticket in view.
 *
 * - **Several tickets** swipe sideways (native scroll-snap). Previous and
 *   Next buttons do the same without a gesture, and each change is said
 *   politely ("Ticket 2 of 2").
 * - **The screen stays awake** while it's open (Screen Wake Lock, where the
 *   browser has it), released on close and while the tab is hidden. The web
 *   can't raise the brightness itself.
 * - A native modal `<dialog>`: focus stays inside, Escape and the ✕ close it,
 *   and focus returns to the button that opened it.
 */
export default function TicketFullScreen({ open, onClose, tickets, numbers, start = 0, footer, onSend }: TicketFullScreenProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Each opening starts on `start`: reset while rendering (not in an effect) when `open` changes.
  const [shown, setShown] = useState({ open, index: start });
  if (shown.open !== open) setShown({ open, index: start });
  const index = Math.min(Math.max(shown.index, 0), Math.max(tickets.length - 1, 0));
  const setIndex = (next: number) => setShown({ open, index: next });
  const reducedMotion = usePrefersReducedMotion();
  const count = tickets.length;
  const number = numbers?.[index] ?? index + 1;

  const scrollToSlide = useCallback((next: number, smooth: boolean) => {
    const track = trackRef.current;
    const slide = track?.children[next];
    if (!track || !(slide instanceof HTMLElement)) return false;
    // scrollTo isn't in every environment (jsdom); the index still follows.
    track.scrollTo?.({ left: slide.offsetLeft - track.offsetLeft, behavior: smooth ? "smooth" : "auto" });
    return true;
  }, []);

  function goTo(next: number) {
    if (scrollToSlide(next, !reducedMotion)) setIndex(next);
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      scrollToSlide(start, false);
    }
    if (!open && dialog.open) dialog.close();
  }, [open, start, scrollToSlide]);

  // Keep the screen awake while the ticket is up; a hidden tab loses the lock, so ask again when it's back.
  useEffect(() => {
    if (!open) return;
    let lock: ScreenWakeLock | null = null;
    // Bumped by every request and by letting go: a lock that arrives for an older request
    // (the tab hid, or showed again, before it resolved) or after close is released, never held.
    let latest = 0;
    const letGo = () => {
      latest += 1;
      void lock?.release();
      lock = null;
    };
    const acquire = () => {
      letGo();
      const request = latest;
      void requestScreenWakeLock().then((got) => {
        if (request === latest) lock = got;
        else void got?.release();
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
      else letGo();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      letGo();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  function onScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const slides = Array.from(track.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    const at = track.scrollLeft + track.offsetLeft;
    let nearest = 0;
    slides.forEach((slide, i) => {
      if (Math.abs(slide.offsetLeft - at) < Math.abs(slides[nearest].offsetLeft - at)) nearest = i;
    });
    if (nearest !== index) setIndex(nearest);
  }

  const barButton = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-paper";
  return (
    <dialog
      ref={ref}
      aria-label="Your ticket"
      onClose={onClose}
      data-surface="ink"
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-ink p-0 text-paper"
    >
      {open && (
        <div className="flex h-full flex-col gap-3 pt-2 pb-4">
          <div className="flex items-center justify-between gap-3 px-3">
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close ticket" className={barButton}>
              <CloseIcon />
            </button>
            <p className="font-mono text-sm leading-5 font-medium" aria-live="polite" aria-atomic="true">
              <span className="uppercase">Ticket</span> {number} of {count}
            </p>
            {onSend ? (
              <button type="button" onClick={() => onSend(index)} className={`${barButton} label-button px-3`}>
                Send
              </button>
            ) : (
              <span className="min-w-11" />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              ref={trackRef}
              onScroll={onScroll}
              className="no-scrollbar flex shrink-0 snap-x snap-mandatory gap-6 overflow-x-auto px-6"
              // A scroll area needs a keyboard way in when it has more than one slide; the buttons below move it too.
              {...(count > 1 ? { tabIndex: 0, role: "group", "aria-label": "Tickets" } : {})}
            >
              {tickets.map((ticket, i) => (
                <div key={i} className="w-full shrink-0 snap-center" inert={i !== index}>
                  {ticket}
                </div>
              ))}
            </div>
          </div>
          {count > 1 && (
            <div className="-my-2 flex shrink-0 items-center justify-center gap-4">
              <TicketPagerButton direction="previous" atEnd={index === 0} onMove={() => goTo(index - 1)} className={barButton} />
              <div aria-hidden="true" className="flex items-center gap-2" data-ticket-dots="">
                {tickets.map((_, i) => (
                  <span key={i} className={`size-1.5 rounded-full ${i === index ? "bg-paper" : "bg-muted"}`} />
                ))}
              </div>
              <TicketPagerButton direction="next" atEnd={index === count - 1} onMove={() => goTo(index + 1)} className={barButton} />
            </div>
          )}
          {footer && <div className="shrink-0 px-6">{footer(index)}</div>}
        </div>
      )}
    </dialog>
  );
}
