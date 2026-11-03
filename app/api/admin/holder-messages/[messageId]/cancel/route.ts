import { adminCancelHolderMessage } from "@/lib/server/handlers/holder-messages";
import { route } from "@/lib/server/route";

export const POST = route(adminCancelHolderMessage);
