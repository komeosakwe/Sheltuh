import { createReport } from "@/lib/server/handlers/reports";
import { route } from "@/lib/server/route";

export const POST = route(createReport);
