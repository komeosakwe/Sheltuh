import { Panel } from "@/components/ui/Section";
import { formatAudExact, formatConversion, formatCount } from "@/lib/analytics-format";
import type { TrackingLinkStats } from "@/lib/api/types";
import DataTable from "./DataTable";
import { ValueOrNoData } from "./NoData";

/**
 * Views and sales per tracking link in the chosen period: the only way
 * sales can be split by where people came from. A deleted link's numbers
 * are kept, shown by its code.
 */
export default function TrackingLinkStatsTable({ links }: { links: TrackingLinkStats[] }) {
  if (links.length === 0) return null;
  return (
    <Panel title="Tracking links in this period" titleId="links-period">
      <DataTable
        caption="Views and sales per tracking link in this period"
        columns={[
          { key: "label", label: "Link" },
          { key: "views", label: "Views", numeric: true },
          { key: "orders", label: "Orders", numeric: true },
          { key: "tickets", label: "Tickets sold", numeric: true },
          { key: "gross", label: "Gross", numeric: true },
          { key: "conversion", label: "Conversion", numeric: true },
        ]}
        rows={links.map((link) => ({
          key: link.code,
          header: link.label ?? (
            <span>
              Deleted link <span className="text-muted">({link.code})</span>
            </span>
          ),
          cells: [
            formatCount(link.views),
            formatCount(link.orders),
            formatCount(link.ticketsSold),
            formatAudExact(link.grossCents),
            <ValueOrNoData key="c" value={formatConversion(link.conversionRate)} />,
          ],
        }))}
      />
    </Panel>
  );
}
