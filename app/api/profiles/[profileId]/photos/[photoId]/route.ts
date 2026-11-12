import { getMemberPhoto } from "@/lib/server/handlers/profile-photos";
import { route } from "@/lib/server/route";

export const GET = route(getMemberPhoto);
