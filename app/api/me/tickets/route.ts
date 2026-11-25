import { listMyTickets } from "@/lib/server/handlers/my-tickets";
import { route } from "@/lib/server/route";

export const GET = route(listMyTickets);
