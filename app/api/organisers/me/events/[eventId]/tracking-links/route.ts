import { createTrackingLink, listTrackingLinks } from "@/lib/server/handlers/tracking-links";
import { route } from "@/lib/server/route";

export const GET = route(listTrackingLinks);
export const POST = route(createTrackingLink);
