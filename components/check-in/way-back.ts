import { DOOR_EVENTS_HREF } from "@/components/admin/event-queue-filters";

/**
 * Where the door's way back goes: an organiser's own events, or, for an
 * admin, the admin event queue's Sheltüh-run list, where admins find the
 * doors they run (they check in only at platform-managed organisers' events;
 * the check-in data doesn't say whose event it is, so every admin gets it).
 */
export interface DoorWayBack {
  href: string;
  /** After "←" in the header. */
  label: string;
  /** A button's words: "Back to your events". */
  backTo: string;
}

export const ORGANISER_WAY_BACK: DoorWayBack = {
  href: "/dashboard",
  label: "Your events",
  backTo: "Back to your events",
};

export const ADMIN_WAY_BACK: DoorWayBack = {
  href: DOOR_EVENTS_HREF,
  label: "Admin door list",
  backTo: "Back to the admin door list",
};
