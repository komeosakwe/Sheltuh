import { describe, expect, it } from "vitest";
import {
  canApplyAsOrganiser,
  canEditEvent,
  canResubmitOrganiser,
  canSubmitEvent,
} from "../lambda/shared/state";

describe("event state transitions", () => {
  it("draft and rejected events can be edited and submitted", () => {
    expect(canEditEvent("draft")).toBe(true);
    expect(canEditEvent("rejected")).toBe(true);
    expect(canSubmitEvent("draft")).toBe(true);
    expect(canSubmitEvent("rejected")).toBe(true);
  });

  it("pending_review and published events are locked", () => {
    expect(canEditEvent("pending_review")).toBe(false);
    expect(canEditEvent("published")).toBe(false);
    expect(canSubmitEvent("pending_review")).toBe(false);
    expect(canSubmitEvent("published")).toBe(false);
  });
});

describe("organiser application transitions", () => {
  it("only a rejected application can be resubmitted", () => {
    expect(canResubmitOrganiser("rejected")).toBe(true);
    expect(canResubmitOrganiser("pending")).toBe(false);
    expect(canResubmitOrganiser("approved")).toBe(false);
  });

  it("a user can apply only when they have no existing application", () => {
    expect(canApplyAsOrganiser(undefined)).toBe(true);
    expect(canApplyAsOrganiser("pending")).toBe(false);
    expect(canApplyAsOrganiser("approved")).toBe(false);
    expect(canApplyAsOrganiser("rejected")).toBe(false);
  });
});
