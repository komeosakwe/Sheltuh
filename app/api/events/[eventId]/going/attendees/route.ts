import { listGoingAttendees } from "@/lib/server/handlers/going";
import { route } from "@/lib/server/route";

export const GET = route(listGoingAttendees);
