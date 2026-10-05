import { initialsFor } from "@/lib/initials";
import { getSampleGoing } from "@/lib/sample-going";

/** Demo "N going" for a card: the fictional sample list's count and its first three initials. */
export function demoGoing(eventId: string): { count: number; initials: string[] } {
  const sample = getSampleGoing(eventId);
  return { count: sample.count, initials: sample.attendees.slice(0, 3).map((a) => initialsFor(a.displayName)) };
}
