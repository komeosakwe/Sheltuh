import { adminGetMemberProfile } from "@/lib/server/handlers/member-profiles";
import { route } from "@/lib/server/route";

export const GET = route(adminGetMemberProfile);
