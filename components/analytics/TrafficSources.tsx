import { Panel } from "@/components/ui/Section";
import { formatCount } from "@/lib/analytics-format";
import type { SourceViews, ViewSource } from "@/lib/api/types";
import DataTable, { type DataRow } from "./DataTable";
import NoData from "./NoData";

const LABELS: Record<ViewSource, string> = {
  tracking: "Your tracking links",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X (Twitter)",
  search: "Search engines",
  email: "Email and newsletters",
  eventbrite: "Eventbrite",
  other: "Other websites",
  direct: "Direct or unknown",
};

/** Display order. The four social networks are listed together under "Social". */
const ORDER: ViewSource[] = ["tracking", "instagram", "facebook", "tiktok", "x", "search", "email", "eventbrite", "other", "direct"];
const SOCIAL: ReadonlySet<ViewSource> = new Set(["instagram", "facebook", "tiktok", "x"]);

/** Whole-percent share, "<1%" for a sliver, null when there's nothing to share. */
export function formatShare(views: number, total: number): string | null {
  if (total <= 0) return null;
  const pct = (views / total) * 100;
  if (pct > 0 && pct < 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

function ViewsCell({ views, total }: { views: number; total: number }) {
  const share = total > 0 ? Math.min(100, (views / total) * 100) : 0;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {formatCount(views)}
      <span aria-hidden="true" className="block h-1 w-16 bg-surface-border">
        <span className="block h-1 bg-foreground" style={{ width: `${share}%` }} />
      </span>
    </span>
  );
}

/**
 * Where the event page's views came from (§5.13), in the API's ten buckets,
 * zeros included. Views only: orders carry a tracking code, not the view's
 * source, so sales can't be split this way (they can by tracking link).
 */
export default function TrafficSources({ sources, counted }: { sources: SourceViews[]; counted: boolean }) {
  const views = new Map(sources.map((s) => [s.source, s.views]));
  const total = ORDER.reduce((sum, source) => sum + (views.get(source) ?? 0), 0);
  const socialTotal = [...SOCIAL].reduce((sum, source) => sum + (views.get(source) ?? 0), 0);

  const rows: DataRow[] = ORDER.map((source) => {
    const n = views.get(source) ?? 0;
    const share = formatShare(n, total);
    return {
      key: source,
      header: LABELS[source],
      group: SOCIAL.has(source) ? "social" : undefined,
      cells: [<ViewsCell key="v" views={n} total={total} />, share ?? <NoData key="s" />],
    };
  });
  const socialShare = formatShare(socialTotal, total);

  return (
    <Panel title="Traffic sources" titleId="traffic-sources">
      {!counted ? (
        <p className="text-sm text-muted">Page views weren&rsquo;t being counted yet in this period.</p>
      ) : (
        <DataTable
          caption="Page views by where people came from"
          columns={[
            { key: "source", label: "Source" },
            { key: "views", label: "Views", numeric: true },
            { key: "share", label: "Share", numeric: true },
          ]}
          rows={rows}
          groups={{ social: { header: "Social", cells: [formatCount(socialTotal), socialShare ?? <NoData key="s" />] } }}
          totals={[formatCount(total), total > 0 ? "100%" : <NoData key="t" />]}
        />
      )}
      <div className="mt-4 flex flex-col gap-1 text-xs text-muted">
        <p>Shares are rounded and may not add to 100%.</p>
        <p>
          Sources come from the address people arrived from, grouped. We don&rsquo;t store the full address or
          anything about the visitor.
        </p>
        <p>Sales can&rsquo;t be split by source, only by tracking link.</p>
      </div>
    </Panel>
  );
}
