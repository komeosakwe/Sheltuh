import { DotsLoader } from "@/components/brand/DotsMark";

/**
 * The event page while it loads (docs/design/brand-direction-one.md §6.14): the loader, centred in the
 * page column. Shown by the route's loading.tsx the moment an event is tapped (before the page's own
 * code has arrived) and by LiveEventDetails while it fetches the event, in the same place, so nothing
 * moves between the two. A polite status says "Loading event" once.
 */
export default function EventPageLoading() {
  return (
    <div className="mx-auto flex max-w-6xl justify-center px-5 py-20 sm:px-8">
      <DotsLoader announce label="Loading event" />
    </div>
  );
}
