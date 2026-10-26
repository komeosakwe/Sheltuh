import { getInviteAccountLink } from "@/lib/server/handlers/invites";
import { route } from "@/lib/server/route";

export const POST = route(getInviteAccountLink);
