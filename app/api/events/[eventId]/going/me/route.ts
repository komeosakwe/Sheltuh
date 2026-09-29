import { deleteMyGoing, getMyGoing, putMyGoing } from "@/lib/server/handlers/going";
import { route } from "@/lib/server/route";

export const GET = route(getMyGoing);
export const PUT = route(putMyGoing);
export const DELETE = route(deleteMyGoing);
