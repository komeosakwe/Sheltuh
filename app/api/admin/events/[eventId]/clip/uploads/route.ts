import { adminCreateClipUpload } from "@/lib/server/handlers/event-clips";
import { route } from "@/lib/server/route";

export const POST = route(adminCreateClipUpload);
