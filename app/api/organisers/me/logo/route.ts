import { deleteMyOrganiserLogo, putMyOrganiserLogo } from "@/lib/server/handlers/organiser-logos";
import { route } from "@/lib/server/route";

export const PUT = route(putMyOrganiserLogo);
export const DELETE = route(deleteMyOrganiserLogo);
