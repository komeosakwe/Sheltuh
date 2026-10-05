import { deleteMyProfile, getMyProfile, putMyProfile } from "@/lib/server/handlers/profiles";
import { route } from "@/lib/server/route";

export const GET = route(getMyProfile);
export const PUT = route(putMyProfile);
export const DELETE = route(deleteMyProfile);
