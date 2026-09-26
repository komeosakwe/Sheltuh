// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApplicationForm from "@/components/organisers/ApplicationForm";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const applyAsOrganiser = vi.fn();
const resubmitOrganiser = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  applyAsOrganiser: (...args: unknown[]) => applyAsOrganiser(...args),
  resubmitOrganiser: (...args: unknown[]) => resubmitOrganiser(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  applyAsOrganiser.mockReset();
  resubmitOrganiser.mockReset();
});

const APPROVED_RECORD: OrganiserRecord = {
  ownerUserId: "user-1",
  organiserId: "org-1",
  displayName: "My Org",
  contactEmail: "org@example.com",
  description: "d",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Organiser name"), { target: { value: "My New Org" } });
  fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "contact@example.com" } });
  fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "We run events." } });
  fireEvent.click(screen.getByLabelText("Live music"));
}

describe("ApplicationForm — session-expiry recovery preserves the form (organiser applications)", () => {
  it("keeps every typed field after an expired-session submit, and only accepts sign-in as the same account", async () => {
    const sessionError = new SessionExpiredError();
    applyAsOrganiser.mockRejectedValueOnce(sessionError).mockResolvedValueOnce(APPROVED_RECORD);
    const signIn = vi.fn().mockResolvedValue(undefined);
    const signOut = vi.fn();
    const onSuccess = vi.fn();

    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com", signIn, signOut })}>
        <ApplicationForm mode="apply" getToken={vi.fn().mockResolvedValue("token")} onSuccess={onSuccess} />
      </FakeAuthProvider>,
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(sessionError.message));
    expect(screen.getByLabelText("Organiser name")).toHaveValue("My New Org");

    // A different account signing in during recovery must not be allowed to
    // submit this applicant's typed details under itself.
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("owner@example.com", "hunter2"));
    expect(signOut).not.toHaveBeenCalled(); // same account — accepted

    // Fields are still exactly as typed; nothing navigated away.
    expect(screen.getByLabelText("Organiser name")).toHaveValue("My New Org");
    expect(screen.getByLabelText("Contact email")).toHaveValue("contact@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(applyAsOrganiser).toHaveBeenCalledTimes(2);
  });
});
