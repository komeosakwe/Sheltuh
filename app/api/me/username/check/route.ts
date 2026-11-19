import { checkMyUsername } from "@/lib/server/handlers/usernames";
import { route } from "@/lib/server/route";

export const POST = route(checkMyUsername);
