import { getWaitlistStatus } from "@/lib/server/handlers/waitlist";
import { route } from "@/lib/server/route";

export const GET = route(getWaitlistStatus);
