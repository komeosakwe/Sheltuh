import { getMe } from "@/lib/server/handlers/me";
import { route } from "@/lib/server/route";

export const GET = route(getMe);
