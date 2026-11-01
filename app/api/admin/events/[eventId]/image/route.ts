import { adminDeleteEventImage, adminPatchEventImageFocus, adminPutEventImage } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

export const PUT = route(adminPutEventImage);
export const PATCH = route(adminPatchEventImageFocus);
export const DELETE = route(adminDeleteEventImage);
