import { deleteMyOrganiserCover, putMyOrganiserCover } from "@/lib/server/handlers/organiser-covers";
import { route } from "@/lib/server/route";

export const PUT = route(putMyOrganiserCover);
export const DELETE = route(deleteMyOrganiserCover);
