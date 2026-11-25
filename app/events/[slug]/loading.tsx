import EventPageLoading from "@/components/events/EventPageLoading";

/**
 * Shown at once when an event is opened from another page: the route renders per request (its link
 * preview reads the event), so without this the last page stayed on screen until the server answered.
 * Prefetched with the links, so it needs no round trip (Next's loading.js).
 */
export default function EventLoading() {
  return <EventPageLoading />;
}
