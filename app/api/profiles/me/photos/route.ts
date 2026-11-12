import { postMyPhoto } from "@/lib/server/handlers/profile-photos";
import { route } from "@/lib/server/route";

export const POST = route(postMyPhoto);
