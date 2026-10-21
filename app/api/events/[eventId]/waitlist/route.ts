import { joinWaitlist, leaveWaitlistAsMember } from "@/lib/server/handlers/waitlist";
import { route } from "@/lib/server/route";

export const POST = route(joinWaitlist);
export const DELETE = route(leaveWaitlistAsMember);
