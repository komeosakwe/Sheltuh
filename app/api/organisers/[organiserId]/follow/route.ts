import { followOrganiser, getFollow, unfollowOrganiser } from "@/lib/server/handlers/follows";
import { route } from "@/lib/server/route";

export const GET = route(getFollow);
export const POST = route(followOrganiser);
export const DELETE = route(unfollowOrganiser);
