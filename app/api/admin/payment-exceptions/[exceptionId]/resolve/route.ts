import { adminResolvePaymentException } from "@/lib/server/handlers/payment-exceptions";
import { route } from "@/lib/server/route";

export const POST = route(adminResolvePaymentException);
