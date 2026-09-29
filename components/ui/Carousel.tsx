"use client";

import { useEffect, useRef, type ReactNode } from "react";

const SPEED_PX_PER_SEC = 36;
const RESUME_AFTER_MS = 2500;

/**
 * Horizontal rail of fixed-width tiles. It runs full-bleed to the edges of the
 * viewport, with padding that keeps the first card aligned to the page's content column.
 *
 * With `autoScroll` it drifts on its own — cards slide left to right, then
 * turn around at the end (no duplicated cards, so every event exists once).
 * It stops while the pointer or keyboard focus is on it, when the person
 * scrolls by hand, and entirely for people who prefer reduced motion; it
 * resumes a moment after they let go. It's always a normal scrollable region.
 */
export default function Carousel({
  children,
  label,
  autoScroll = false,
}: {
  children: ReactNode;
  label: string;
  autoScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let last = 0;
    let pos = 0;
    let direction = -1; // -1: cards move left → right (view travels toward the start)
    let paused = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let started = false;

    const maxScroll = () => el.scrollWidth - el.clientWidth;

    function setSnap(on: boolean) {
      if (el) el.style.scrollSnapType = on ? "" : "none";
    }

    function pause() {
      paused = true;
      clearTimeout(resumeTimer);
      setSnap(true);
    }

    function resumeSoon() {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!el) return;
        pos = el.scrollLeft;
        paused = false;
        setSnap(false);
      }, RESUME_AFTER_MS);
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      const max = maxScroll();
      if (max <= 0 || !el) {
        last = now;
        return;
      }
      if (!started) {
        started = true;
        pos = max; // begin at the end so the first move is left → right
        el.scrollLeft = pos;
        setSnap(false);
      }
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (paused) return;
      pos += direction * SPEED_PX_PER_SEC * dt;
      if (pos <= 0) {
        pos = 0;
        direction = 1;
      } else if (pos >= max) {
        pos = max;
        direction = -1;
      }
      el.scrollLeft = pos;
    }

    const interrupt = () => {
      pause();
      resumeSoon();
    };
    const hold = () => pause();
    const release = () => resumeSoon();

    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
    el.addEventListener("touchstart", interrupt, { passive: true });
    el.addEventListener("wheel", interrupt, { passive: true });
    el.addEventListener("keydown", interrupt);

    raf = requestAnimationFrame((t) => {
      last = t;
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resumeTimer);
      el.removeEventListener("pointerenter", hold);
      el.removeEventListener("pointerleave", release);
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", release);
      el.removeEventListener("touchstart", interrupt);
      el.removeEventListener("wheel", interrupt);
      el.removeEventListener("keydown", interrupt);
      el.style.scrollSnapType = "";
    };
  }, [autoScroll]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="no-scrollbar ml-[calc(50%-50vw)] flex w-screen snap-x snap-mandatory gap-5 overflow-x-auto scroll-pl-[var(--rail-gutter)] pb-2 pl-[var(--rail-gutter)] pr-[var(--rail-gutter)] [--rail-gutter:max(1.25rem,calc((100vw-72rem)/2+1.25rem))] sm:gap-6 sm:[--rail-gutter:max(2rem,calc((100vw-72rem)/2+2rem))]"
    >
      {children}
    </div>
  );
}

export function CarouselItem({ children }: { children: ReactNode }) {
  return <div className="w-[68vw] max-w-[320px] shrink-0 snap-start sm:w-[280px]">{children}</div>;
}
