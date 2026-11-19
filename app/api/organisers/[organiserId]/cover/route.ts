import { getOrganiserCover } from "@/lib/server/handlers/organiser-covers";
import { route } from "@/lib/server/route";

export const GET = route(getOrganiserCover);
