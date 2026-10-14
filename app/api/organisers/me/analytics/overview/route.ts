import { getAnalyticsOverview } from "@/lib/server/handlers/analytics";
import { route } from "@/lib/server/route";

export const GET = route(getAnalyticsOverview);
