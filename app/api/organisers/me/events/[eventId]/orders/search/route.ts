import { searchEventOrders } from "@/lib/server/handlers/event-orders";
import { route } from "@/lib/server/route";

export const POST = route(searchEventOrders);
