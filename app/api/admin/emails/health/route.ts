import { adminEmailOutboxHealth } from "@/lib/server/handlers/email-outbox";
import { route } from "@/lib/server/route";

export const GET = route(adminEmailOutboxHealth);
