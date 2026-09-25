import { submitEventForReview } from "@/lib/server/handlers/events";
import { route } from "@/lib/server/route";

export const POST = route(submitEventForReview);
