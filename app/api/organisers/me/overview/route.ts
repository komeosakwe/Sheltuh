import { getMyOverview } from "@/lib/server/handlers/organiser-summary";
import { route } from "@/lib/server/route";

export const GET = route(getMyOverview);
