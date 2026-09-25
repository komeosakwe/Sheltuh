import type { EventStatus, OrganiserStatus } from "./types";

export const EDITABLE_EVENT_STATUSES: EventStatus[] = ["draft", "rejected"];
export const SUBMITTABLE_EVENT_STATUSES: EventStatus[] = ["draft", "rejected"];

export function canEditEvent(status: EventStatus): boolean {
  return EDITABLE_EVENT_STATUSES.includes(status);
}

export function canSubmitEvent(status: EventStatus): boolean {
  return SUBMITTABLE_EVENT_STATUSES.includes(status);
}

export const RESUBMITTABLE_ORGANISER_STATUSES: OrganiserStatus[] = ["rejected"];

export function canResubmitOrganiser(status: OrganiserStatus): boolean {
  return RESUBMITTABLE_ORGANISER_STATUSES.includes(status);
}

export function canApplyAsOrganiser(existing: OrganiserStatus | undefined): boolean {
  // No existing application, or a rejected one being turned into a fresh
  // application, are both fine. A pending or approved application blocks a
  // second POST /organisers/apply — that path is PATCH /organisers/me instead.
  return existing === undefined;
}
