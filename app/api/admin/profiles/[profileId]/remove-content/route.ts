import { adminRemoveProfileContent } from "@/lib/server/handlers/member-profiles";
import { route } from "@/lib/server/route";

export const POST = route(adminRemoveProfileContent);
