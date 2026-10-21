import { leaveWaitlist } from "@/lib/server/handlers/waitlist";
import { route } from "@/lib/server/route";

export const POST = route(leaveWaitlist);
