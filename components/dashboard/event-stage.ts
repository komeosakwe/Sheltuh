import type { OrganiserEventStage } from "@/lib/api/types";
import type { DashTone } from "./ui/tones";

/**
 * Each stage's status pill on the organiser's event cards (Latte's "Dash / Status pill"): Live
 * green, Sold out red, Draft and Ended grey, as the Events frame 433:7341 draws them. The stages
 * the frames don't draw get words of their own in the tones' meanings (components/dashboard/ui/tones.ts):
 * In review yellow (being processed; the editor's locked view and status badge say "In review" too,
 * lib/organiser-events.ts), Changes needed red, Unpublished grey. The word always carries the state,
 * never the colour alone.
 */
export const STAGE_PILL: Record<OrganiserEventStage, { label: string; tone: DashTone }> = {
  live: { label: "Live", tone: "green" },
  sold_out: { label: "Sold out", tone: "red" },
  ended: { label: "Ended", tone: "grey" },
  draft: { label: "Draft", tone: "grey" },
  in_review: { label: "In review", tone: "yellow" },
  changes_needed: { label: "Changes needed", tone: "red" },
  unpublished: { label: "Unpublished", tone: "grey" },
};

/** Stages still being made, whose card says "Continue →" (Latte's drafts) rather than "Manage →". */
export function continuesStage(stage: OrganiserEventStage): boolean {
  return stage === "draft" || stage === "changes_needed" || stage === "unpublished";
}
