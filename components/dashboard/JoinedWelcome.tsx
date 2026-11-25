"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/Section";

/**
 * `?welcome=organiser`: they've just joined with an organiser link
 * (components/organisers/OrganiserJoinFlow.tsx JOINED_PATH, which lands on the dashboard's
 * Overview). Read once after hydration, then taken out of the address bar, so a reload or a shared
 * URL doesn't say it again.
 */
export function useJoinedWelcome(): boolean {
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("welcome") !== "organiser") return;
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    queueMicrotask(() => setWelcome(true));
  }, []);
  return welcome;
}

/** The welcome after joining: takes focus once, so it's read out before the rest of the page. */
export default function JoinedWelcome({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} data-joined-welcome="" className="outline-offset-2">
      <Notice>
        <p className="font-semibold">Welcome to Sheltüh, {name}.</p>
        <p className="mt-1">
          Add a bio and links on{" "}
          <Link href="/dashboard/profile" className="text-accent underline underline-offset-2">
            your profile
          </Link>
          , and set up payouts before selling paid tickets. Your first paid event is checked by Sheltüh before it
          goes live.
        </p>
      </Notice>
    </div>
  );
}
