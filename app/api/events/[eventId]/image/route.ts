import { deleteEventImage, getEventImage, putEventImage } from "@/lib/server/handlers/event-images";
import { route } from "@/lib/server/route";

export const GET = route(getEventImage);
export const PUT = route(putEventImage);
export const DELETE = route(deleteEventImage);
