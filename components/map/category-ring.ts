import type { EventCategory } from "@/lib/types";

/**
 * The ring colour around a photo marker, one per category. Full literal class
 * names so Tailwind can see them. Tokens live in app/globals.css (`--cat-*`).
 */
export const CATEGORY_RING_CLASS: Record<EventCategory, string> = {
  "live-music": "bg-cat-live-music",
  art: "bg-cat-art",
  workshop: "bg-cat-workshop",
  "pop-up": "bg-cat-pop-up",
  theatre: "bg-cat-theatre",
};
