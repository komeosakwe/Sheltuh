import { getOrganiserLogo } from "@/lib/server/handlers/organiser-logos";
import { route } from "@/lib/server/route";

export const GET = route(getOrganiserLogo);
