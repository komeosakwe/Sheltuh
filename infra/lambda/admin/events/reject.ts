import { requireAdmin } from "../../shared/auth";
import { badRequest, handle, ok, parseBody, type ApiEvent } from "../../shared/http";
import { moderateEvent } from "../../shared/moderate-event";
import { fail, requireString } from "../../shared/validation";

interface RejectBody {
  reason?: unknown;
}

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const adminSub = requireAdmin(event);
    const { organiserId, eventId } = event.pathParameters ?? {};
    if (!organiserId || !eventId) return badRequest("Missing organiserId or eventId in the URL.");

    const body = parseBody<RejectBody>(event) ?? {};
    const errors: Record<string, string> = {};
    const reason = requireString(body.reason, "reason", errors, 1000);
    if (Object.keys(errors).length > 0) fail(errors);

    const record = await moderateEvent({
      organiserId,
      eventId,
      fromStatus: "pending_review",
      toStatus: "rejected",
      by: adminSub,
      action: "rejected",
      reason,
    });
    return ok(record);
  });
