import { adminCreateOrganiserLink, adminListOrganiserLinks } from "@/lib/server/handlers/organiser-links";
import { route } from "@/lib/server/route";

export const GET = route(adminListOrganiserLinks);
export const POST = route(adminCreateOrganiserLink);
