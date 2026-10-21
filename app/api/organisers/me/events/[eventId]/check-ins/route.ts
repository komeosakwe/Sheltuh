import { checkInTicket, getCheckInSummary } from "@/lib/server/handlers/check-ins";
import { route } from "@/lib/server/route";

export const GET = route(getCheckInSummary);
export const POST = route(checkInTicket);
