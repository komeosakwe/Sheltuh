import { RESULTS_GRID } from "@/components/EventResults";
import { EventCardPlaceholder } from "@/components/ui/EventCard";
import { ProgressLoader } from "@/components/ui/ProgressLoader";

/**
 * An event feed while it loads: the branded loader with its estimated
 * percentage, over the grid's shape (flat placeholders, no shimmer), so the
 * results take the same place when they arrive. The host owns the polite
 * "Loading events…" status.
 */
export default function FeedLoading({ percent, done }: { percent: number; done: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <ProgressLoader percent={percent} done={done} label="Loading events" />
      <div aria-hidden="true" className={RESULTS_GRID}>
        <EventCardPlaceholder />
        <EventCardPlaceholder />
        {/* A whole first row: two columns, four from 1024px. */}
        <div className="hidden lg:block">
          <EventCardPlaceholder />
        </div>
        <div className="hidden lg:block">
          <EventCardPlaceholder />
        </div>
      </div>
    </div>
  );
}
