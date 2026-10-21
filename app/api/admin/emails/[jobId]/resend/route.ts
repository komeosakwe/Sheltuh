import { adminResendEmailJob } from "@/lib/server/handlers/email-outbox";
import { route } from "@/lib/server/route";

export const POST = route(adminResendEmailJob);
