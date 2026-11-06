import { adminListTransfers } from "@/lib/server/handlers/payouts";
import { route } from "@/lib/server/route";

export const GET = route(adminListTransfers);
