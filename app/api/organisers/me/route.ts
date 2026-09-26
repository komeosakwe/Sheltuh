import { getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { route } from "@/lib/server/route";

export const GET = route(getMyOrganiser);
export const PATCH = route(resubmitOrganiser);
