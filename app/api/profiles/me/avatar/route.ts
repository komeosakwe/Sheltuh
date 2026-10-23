import { deleteMyAvatar, getMyAvatar, putMyAvatar } from "@/lib/server/handlers/profiles";
import { route } from "@/lib/server/route";

export const GET = route(getMyAvatar);
export const PUT = route(putMyAvatar);
export const DELETE = route(deleteMyAvatar);
