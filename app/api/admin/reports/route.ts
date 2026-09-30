import { adminListReports } from "@/lib/server/handlers/reports";
import { route } from "@/lib/server/route";

export const GET = route(adminListReports);
