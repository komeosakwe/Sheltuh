import { deleteSeatMap, getSeatMap, putSeatMap } from "@/lib/server/handlers/seating";
import { route } from "@/lib/server/route";

export const GET = route(getSeatMap);
export const PUT = route(putSeatMap);
export const DELETE = route(deleteSeatMap);
