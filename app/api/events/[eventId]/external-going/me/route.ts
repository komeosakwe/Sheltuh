import { deleteMyExternalGoing, getMyExternalGoing, putMyExternalGoing } from "@/lib/server/handlers/external-going";
import { route } from "@/lib/server/route";

export const GET = route(getMyExternalGoing);
export const PUT = route(putMyExternalGoing);
export const DELETE = route(deleteMyExternalGoing);
