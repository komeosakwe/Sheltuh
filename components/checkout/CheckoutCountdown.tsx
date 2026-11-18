"use client";

import { useEffect, useRef, useState } from "react";
import { countdownAnnouncement, formatCountdown, isCountdownUrgent, msUntilNextSecond } from "@/lib/checkout-countdown";
import { ClockIcon } from "./icons";

/**
 * "Complete your order in 14:32" above Stripe's form (docs/design/checkout-pay.md §5.2, Countdown).
 * `deadline` is the pay deadline on this device's clock (lib/checkout-countdown.ts localDeadline), so
 * the time left is always worked out afresh from it: each tick, and whenever the page is shown again
 * (a tab brought back, a phone woken), never by counting ticks, which a sleeping device skips.
 *
 * The ticking text isn't a live region. `onAnnounce` is called only on passing 5:00 and 1:00, and at
 * time's up, for the page's own polite live region; `onTimeUp` once, when the time left reaches zero.
 * In the last two minutes it turns orange (contrast-safe --signal-ink on --tint) with a clock icon and
 * bold words, so colour isn't the only change. No animation.
 */
export default function CheckoutCountdown({
  deadline,
  onTimeUp,
  onAnnounce,
}: {
  deadline: number;
  onTimeUp: () => void;
  onAnnounce: (message: string) => void;
}) {
  const [msLeft, setMsLeft] = useState(() => deadline - Date.now());
  const callbacks = useRef({ onTimeUp, onAnnounce });
  useEffect(() => {
    callbacks.current = { onTimeUp, onAnnounce };
  }, [onTimeUp, onAnnounce]);

  useEffect(() => {
    // What the time left was last time it was read: the moments to announce are the ones passed since.
    let before = deadline - Date.now();
    let timer: number | undefined;
    let finished = false;
    const tick = () => {
      window.clearTimeout(timer);
      if (finished) return;
      const left = deadline - Date.now();
      const message = countdownAnnouncement(before, left);
      before = left;
      setMsLeft(left);
      if (message) callbacks.current.onAnnounce(message);
      if (!(left > 0)) {
        finished = true;
        callbacks.current.onTimeUp();
        return;
      }
      timer = window.setTimeout(tick, msUntilNextSecond(left));
    };
    timer = window.setTimeout(tick, msUntilNextSecond(before));
    // Timers stall while a tab is hidden or the device sleeps: read the clock again when it's back.
    const onShow = () => {
      if (document.visibilityState !== "hidden") tick();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      finished = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [deadline]);

  const urgent = isCountdownUrgent(msLeft);
  return (
    // Stays in view while the buyer scrolls through Stripe's form, just under the sticky site header.
    <div className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-20 -mt-2 mb-2 bg-background py-2 lg:max-w-xl">
      <p
        data-countdown
        data-urgent={urgent ? "true" : undefined}
        className={`flex min-h-11 items-center gap-2 rounded-control border px-4 py-2 text-sm ${
          urgent ? "border-signal-ink bg-tint font-semibold text-signal-ink" : "border-foreground bg-card text-foreground"
        }`}
      >
        {urgent ? <ClockIcon /> : null}
        <span>
          Complete your order in <span className="font-semibold tabular-nums">{formatCountdown(msLeft)}</span>
        </span>
      </p>
    </div>
  );
}
