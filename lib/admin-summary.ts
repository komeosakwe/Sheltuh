import type { AdminSummary } from "./api/types";

/**
 * What the admin summary (GET /api/admin/summary) means in words, shared by
 * the main nav's Admin badge, the admin sub-nav and the admin hub, so the
 * three always agree.
 */

/** Everything waiting for an admin to act: open reports, events and organisers to review, failed emails. */
export function needsYouTotal(summary: AdminSummary): number {
  return (
    summary.reportsOpen.count +
    summary.eventsPending.count +
    summary.organisersPending.count +
    summary.emailsFailed.count
  );
}

/** "1 event" / "3 events", with en-AU digit grouping. */
export function countText(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;
}

/** A window in hours as people say it: 72 → "3 days", 24 → "24 hours", 1 → "1 hour". */
export function hoursText(hours: number): string {
  if (hours > 24 && hours % 24 === 0) return countText(hours / 24, "day", "days");
  return countText(hours, "hour", "hours");
}

/** The admin areas that have a count, and what that count is called ("3 open", "2 waiting"). */
export type AdminArea = "reports" | "events" | "organisers" | "emails";

export function areaCount(summary: AdminSummary, area: AdminArea): number {
  switch (area) {
    case "reports":
      return summary.reportsOpen.count;
    case "events":
      return summary.eventsPending.count;
    case "organisers":
      return summary.organisersPending.count;
    case "emails":
      return summary.emailsFailed.count;
  }
}

/** The word after an area's count: "3 open", "2 waiting", "1 failed". */
export const AREA_COUNT_WORD: Record<AdminArea, string> = {
  reports: "open",
  events: "waiting",
  organisers: "waiting",
  emails: "failed",
};
