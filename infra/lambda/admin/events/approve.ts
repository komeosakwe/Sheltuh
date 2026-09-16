import { requireAdmin } from "../../shared/auth";
import { badRequest, handle, ok, type ApiEvent } from "../../shared/http";
import { moderateEvent } from "../../shared/moderate-event";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const adminSub = requireAdmin(event);
    const { organiserId, eventId } = event.pathParameters ?? {};
    if (!organiserId || !eventId) return badRequest("Missing organiserId or eventId in the URL.");

    const record = await moderateEvent({
      organiserId,
      eventId,
      fromStatus: "pending_review",
      toStatus: "published",
      by: adminSub,
      action: "approved",
    });
    return ok(record);
  });
