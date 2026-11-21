import { changeOrderEmail } from "@/lib/server/handlers/order-email";
import { route } from "@/lib/server/route";

export const POST = route(changeOrderEmail);
