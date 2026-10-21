import { adminListOrganisers } from "@/lib/server/handlers/admin";
import { adminCreateOrganiser } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

export const GET = route(adminListOrganisers);
export const POST = route(adminCreateOrganiser);
