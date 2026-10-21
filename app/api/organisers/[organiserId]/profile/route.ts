import { getPublicOrganiserProfile } from "@/lib/server/handlers/public-organisers";
import { route } from "@/lib/server/route";

export const GET = route(getPublicOrganiserProfile);
