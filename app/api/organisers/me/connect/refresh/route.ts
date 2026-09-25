import { connectRefresh } from "@/lib/server/handlers/organisers";
import { route } from "@/lib/server/route";

export const POST = route(connectRefresh);
