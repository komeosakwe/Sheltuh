import { LoadingState } from "@/components/ui/ProgressLoader";
import { Page } from "@/components/ui/Section";

/**
 * An organiser page the moment it's opened, inside the dashboard's frame (which stays): the loader
 * where the page will be. An event's own pages render per request, so without this the last page
 * stayed on screen until the server answered.
 */
export default function DashboardLoading() {
  return (
    <Page padding="subNav">
      <LoadingState text="Loading page…" />
    </Page>
  );
}
