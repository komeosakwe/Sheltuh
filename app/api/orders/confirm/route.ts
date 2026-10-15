import { confirmFreeOrder } from "@/lib/server/handlers/free-orders";
import { route } from "@/lib/server/route";

export const POST = route(confirmFreeOrder);
