import { undoCheckIn } from "@/lib/server/handlers/check-ins";
import { route } from "@/lib/server/route";

export const POST = route(undoCheckIn);
