import { getMyInvite } from "@/lib/server/handlers/invites";
import { route } from "@/lib/server/route";

export const GET = route(getMyInvite);
