import { getOrderBySession } from "@/lib/server/handlers/orders";
import { route } from "@/lib/server/route";

export const GET = route(getOrderBySession);
