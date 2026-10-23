import { getSeatAvailability } from "@/lib/server/handlers/seating";
import { route } from "@/lib/server/route";

export const GET = route(getSeatAvailability);
