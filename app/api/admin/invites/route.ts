import { adminCreateInvite, adminListInvites } from "@/lib/server/handlers/invites";
import { route } from "@/lib/server/route";

export const GET = route(adminListInvites);
export const POST = route(adminCreateInvite);
