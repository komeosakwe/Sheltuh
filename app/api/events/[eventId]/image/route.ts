import { deleteEventImage, getEventImage, patchEventImageFocus, putEventImage } from "@/lib/server/handlers/event-images";
import { route } from "@/lib/server/route";

export const GET = route(getEventImage);
export const PUT = route(putEventImage);
export const PATCH = route(patchEventImageFocus);
export const DELETE = route(deleteEventImage);
