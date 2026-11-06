import { getEventOrders } from "@/lib/server/handlers/event-orders";
import { route } from "@/lib/server/route";

export const GET = route(getEventOrders);
