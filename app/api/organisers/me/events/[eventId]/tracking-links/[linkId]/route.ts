import { deleteTrackingLink } from "@/lib/server/handlers/tracking-links";
import { route } from "@/lib/server/route";

export const DELETE = route(deleteTrackingLink);
