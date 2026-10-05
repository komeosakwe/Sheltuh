import { createBlock, listBlocks } from "@/lib/server/handlers/blocks";
import { route } from "@/lib/server/route";

export const GET = route(listBlocks);
export const POST = route(createBlock);
