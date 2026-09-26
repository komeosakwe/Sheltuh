import { getPublicEventBySlug } from "@/lib/server/handlers/public-events";
import { route } from "@/lib/server/route";

export const GET = route(getPublicEventBySlug);
