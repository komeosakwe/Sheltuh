import { deleteMyUsername, putMyUsername } from "@/lib/server/handlers/usernames";
import { route } from "@/lib/server/route";

export const PUT = route(putMyUsername);
export const DELETE = route(deleteMyUsername);
