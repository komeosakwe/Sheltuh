import { deleteMyPhoto, patchMyPhoto } from "@/lib/server/handlers/profile-photos";
import { route } from "@/lib/server/route";

export const PATCH = route(patchMyPhoto);
export const DELETE = route(deleteMyPhoto);
