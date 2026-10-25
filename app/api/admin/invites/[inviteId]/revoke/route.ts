import { adminRevokeInvite } from "@/lib/server/handlers/invites";
import { route } from "@/lib/server/route";

export const POST = route(adminRevokeInvite);
