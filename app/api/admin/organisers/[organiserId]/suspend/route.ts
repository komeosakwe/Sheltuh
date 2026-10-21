import { adminSuspendOrganiser } from "@/lib/server/handlers/admin";
import { route } from "@/lib/server/route";

export const POST = route(adminSuspendOrganiser);
