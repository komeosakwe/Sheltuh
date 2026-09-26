import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import { route } from "@/lib/server/route";

export const POST = route(applyAsOrganiser);
