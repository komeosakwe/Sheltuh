import { getMyOrganiser, resubmitOrganiser } from "@/lib/server/handlers/organisers";
import { route } from "@/lib/server/route";

// A resubmitted application's review email is sent after the response (sendReviewEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(getMyOrganiser);
export const PATCH = route(resubmitOrganiser);
