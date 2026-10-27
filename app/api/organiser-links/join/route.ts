import { joinWithOrganiserLink } from "@/lib/server/handlers/organiser-links";
import { route } from "@/lib/server/route";

export const POST = route(joinWithOrganiserLink);
