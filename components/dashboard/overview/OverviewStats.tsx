import StatCard from "@/components/dashboard/ui/StatCard";
import type { OrganiserOverview } from "@/lib/api/types";
import { formatWeekCount } from "@/lib/organiser-dashboard";

/**
 * The Overview's three stat cards (Latte 430:7340 "Stats": "+86 Tickets this week", "+412 Event
 * page views", "+21 New followers"), the shared "Dash / Stat", 16px apart: three across from 640px,
 * two and one on phones as the 390 frame draws them. All are the last 7 Melbourne days, today
 * included (the API's `thisWeek`); followers are a count only. Views the API says may be short
 * (some days not counted yet, or some views not recorded) get a line under the cards saying so,
 * rather than passing a low number off as the whole.
 */
export default function OverviewStats({ week }: { week: OrganiserOverview["thisWeek"] }) {
  const viewsShort = week.viewsUnreliable || !week.viewsComplete;
  return (
    <section aria-label="This week" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard value={formatWeekCount(week.ticketsSold)} label="Tickets this week" />
        <StatCard value={formatWeekCount(week.views)} label="Event page views" />
        <StatCard value={formatWeekCount(week.newFollowers)} label="New followers" />
      </div>
      {viewsShort && (
        <p data-views-note="" className="body-s text-muted">
          Some of this week’s page views weren’t counted, so the number may be low.
        </p>
      )}
    </section>
  );
}
