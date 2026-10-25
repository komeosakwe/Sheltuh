import { submitEventForReview } from "@/lib/server/handlers/events";
import { route } from "@/lib/server/route";

// The admins' review email is sent after the response (sendReviewEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(submitEventForReview);
