import { adminTransferAction } from "@/lib/server/handlers/payouts";
import { route } from "@/lib/server/route";

export const POST = route(adminTransferAction);
