import { deleteBlock } from "@/lib/server/handlers/blocks";
import { route } from "@/lib/server/route";

export const DELETE = route(deleteBlock);
