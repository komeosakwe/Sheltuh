import { cancelPendingOrder } from "@/lib/server/handlers/orders";
import { route } from "@/lib/server/route";

export const POST = route(cancelPendingOrder);
