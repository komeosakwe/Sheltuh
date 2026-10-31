"use client";

import { useEffect, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Section";
import { isApiConfigured } from "@/lib/api/client";
import { getExternalGoingSummary, getMyExternalGoing, setExternalGoing, unsetExternalGoing } from "@/lib/api/going";
import type { ExternalGoingSummary, MyExternalGoing } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { demoGoing, GOING_COUNT_MIN } from "@/lib/event-card";
import { withNext } from "@/lib/safe-next-path";
import ActionErrorNotice from "./whos-going/ActionErrorNotice";
import { mutationErrorMessage, pillClass } from "./whos-going/shared";

/**
 * "Who's going" for an external-ticket event (docs/architecture.md, "External
 * ticketing"): Sheltüh can't verify tickets sold elsewhere, so this is a
 * count only. Signed-in members tap "I'm going" (tap again to undo); the
 * count shows from three people, the same rule as Who's Going. No names,
 * faces or messages. Nothing once the event has ended or if the load fails.
 * The demo shows a sample count and a disabled button.
 */
export default function ExternalGoing({
  event,
}: {
  event: { id: string; slug: string; organiserId?: string; startsAt?: string; endsAt?: string };
}) {
  const auth = useOptionalAuth();
  const authStatus = auth?.configured ? auth.status : "signed-out";
  const getToken = authStatus === "signed-in" ? auth?.getAccessToken : undefined;
  const live = isApiConfigured && Boolean(event.organiserId);

  const [mountedAt] = useState(() => Date.now());
  const endMs = Date.parse(event.endsAt ?? event.startsAt ?? "");
  const demoEnded = Number.isFinite(endMs) && endMs <= mountedAt;

  const [summary, setSummary] = useState<ExternalGoingSummary | "error" | null>(null);
  const [mine, setMine] = useState<MyExternalGoing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    getExternalGoingSummary(event.id).then(
      (s) => !cancelled && setSummary(s),
      () => !cancelled && setSummary("error"),
    );
    return () => {
      cancelled = true;
    };
  }, [live, event.id]);

  useEffect(() => {
    if (!live || !getToken) return;
    let cancelled = false;
    getMyExternalGoing(event.id, getToken).then(
      (m) => !cancelled && setMine(m),
      () => undefined, // The button still works; a failed tap says why.
    );
    return () => {
      cancelled = true;
    };
  }, [live, event.id, getToken]);

  if (!live) {
    if (demoEnded) return null;
    const { count } = demoGoing(event.id);
    return (
      <Panel title="Who's going" titleId="external-going-title">
        <div className="flex flex-col items-start gap-3">
          {count >= GOING_COUNT_MIN && <p className="text-base leading-6 font-semibold">{count} going (sample)</p>}
          <Button size="lg" disabled className="w-full sm:w-auto">
            I&rsquo;m going
          </Button>
          <DemoNotice>Sample count.</DemoNotice>
        </div>
      </Panel>
    );
  }

  if (summary === null || summary === "error" || summary.closed) return null;
  const going = Boolean(mine?.going);
  const showCount = !summary.countHidden && summary.count >= GOING_COUNT_MIN;

  async function toggle() {
    if (!getToken || busy) return;
    const was = going;
    setBusy(true);
    setError(null);
    try {
      const next = await (was ? unsetExternalGoing : setExternalGoing)(event.id, getToken);
      setMine(next);
      // A withheld count (under three) isn't known, so it stays withheld until the next load.
      setSummary((s) =>
        s && s !== "error" && !s.countHidden && next.going !== was
          ? { ...s, count: Math.max(0, s.count + (next.going ? 1 : -1)) }
          : s,
      );
      setAnnouncement(next.going ? "You're going." : "Removed.");
    } catch (err) {
      setError(mutationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Who's going" titleId="external-going-title">
      <div className="flex flex-col items-start gap-3">
        {showCount && <p className="text-base leading-6 font-semibold">{summary.count} going</p>}
        {error && <ActionErrorNotice message={error} returnTo={`/events/${event.slug}`} />}
        {authStatus === "signed-out" && (
          <ButtonLink variant="outline" size="lg" href={withNext("/login", `/events/${event.slug}`)} className={pillClass}>
            I&rsquo;m going
          </ButtonLink>
        )}
        {authStatus === "signed-in" && (
          <Button variant="outline" size="lg" busy={busy} onClick={toggle} className={pillClass}>
            {going ? "Going ✓" : "I’m going"}
          </Button>
        )}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </Panel>
  );
}
