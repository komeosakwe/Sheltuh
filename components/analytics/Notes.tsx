import { Panel } from "@/components/ui/Section";
import { formatDay, formatDayLong } from "@/lib/analytics-format";

/** "How we count" (§5.16): also the explainer whenever there's no data. */
export function AnalyticsPrivacyNote() {
  return (
    <Panel title="How we count" titleId="how-we-count">
      <p className="max-w-2xl text-sm leading-relaxed">
        We add up page views and sales once per event per day, as totals. We don&rsquo;t use cookies, store IP
        addresses or give visitors an ID, so we can&rsquo;t show unique visitors. A view counts under where the
        visit to Sheltüh began. Today&rsquo;s numbers are still adding up.
      </p>
    </Panel>
  );
}

/** Layout reserve for later stages (§5.17). No fake chart, no placeholder numbers. */
export function LaterStagesNote() {
  return (
    <section className="border-t border-surface-border pt-5">
      <p className="eyebrow text-muted">Coming later</p>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Which suburbs your attendees come from. It&rsquo;ll appear here when it&rsquo;s ready.
      </p>
    </section>
  );
}

/** "—" footnotes for views (§5.19): when counting began, and days where some views may be missing. */
export function ViewsFootnote({
  coverage,
  viewsTrackedSince,
  unreliable,
  unreliableRange = false,
}: {
  coverage: "all" | "partial" | "none";
  viewsTrackedSince: string | null;
  /** Days (YYYY-MM-DD) flagged as possibly missing views (an optional API flag). */
  unreliable: string[];
  /** The whole range is flagged (no per-day detail). */
  unreliableRange?: boolean;
}) {
  const notes: string[] = [];
  if (coverage === "none") notes.push("Page views weren't being counted yet in this period, so views and conversion show no data.");
  if (coverage === "partial" && viewsTrackedSince) {
    notes.push(`Views were first counted on ${formatDayLong(viewsTrackedSince)}, so views only cover the days since and conversion shows no data.`);
  }
  if (unreliable.length > 0) notes.push(`Some views may be missing on these days: ${unreliable.map(formatDay).join(", ")}.`);
  else if (unreliableRange) notes.push("Some views may be missing in this period.");
  if (notes.length === 0) return null;
  return (
    <>
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </>
  );
}
