import { listMyFollowing } from "@/lib/server/handlers/follows";
import { route } from "@/lib/server/route";

export const GET = route(listMyFollowing);
