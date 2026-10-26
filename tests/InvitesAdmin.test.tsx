// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOwnerProvider } from "@/components/admin/AdminSessionExpired";
import InvitesAdmin from "@/components/admin/InvitesAdmin";
import OrganiserEditLog from "@/components/admin/OrganiserEditLog";
import { ApiError } from "@/lib/api/client";
import type { AdminInviteRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime } from "@/lib/format";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { fakeUrl } from "./test-utils/fakeUrl";

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListInvites = vi.fn();
const adminCreateInvite = vi.fn();
const adminResendInvite = vi.fn();
const adminRevokeInvite = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListInvites: (...args: unknown[]) => adminListInvites(...args),
  adminCreateInvite: (...args: unknown[]) => adminCreateInvite(...args),
  adminResendInvite: (...args: unknown[]) => adminResendInvite(...args),
  adminRevokeInvite: (...args: unknown[]) => adminRevokeInvite(...args),
}));

function invite(id: string, overrides: Partial<AdminInviteRecord> = {}): AdminInviteRecord {
  return {
    inviteId: id,
    kind: "organiser",
    email: `${id}@example.com`,
    status: "pending",
    organiserName: `Org ${id}`,
    createdAt: "2026-10-20T00:00:00.000Z",
    expiresAt: "2026-11-03T00:00:00.000Z",
    lastSentAt: "2026-10-20T00:00:00.000Z",
    sendCount: 1,
    ...overrides,
  };
}

beforeEach(() => {
  fakeUrl.set("");
  fakeUrl.replace.mockReset();
  for (const fn of [adminListInvites, adminCreateInvite, adminResendInvite, adminRevokeInvite]) fn.mockReset();
  adminListInvites.mockResolvedValue({ items: [] });
});
afterEach(cleanup);

let auth = fakeAuthValue({ isAdmin: true });

function renderPage() {
  auth = fakeAuthValue({ isAdmin: true, email: "admin@example.com" });
  render(
    <FakeAuthProvider value={auth}>
      {/* As AdminShell does on every admin page: the admin these pages are open as. */}
      <AdminOwnerProvider>
        <InvitesAdmin />
      </AdminOwnerProvider>
    </FakeAuthProvider>,
  );
  return screen.getByRole("form", { name: "Invite someone" });
}

function signInAgain(within_: HTMLElement) {
  fireEvent.change(within(within_).getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(within(within_).getByRole("button", { name: "Sign in" }));
}

/** The list's announcement of a load that was asked for (a filter, Try again). */
const loadStatus = () => {
  const status = document.getElementById("invites-load-status");
  if (!status) throw new Error("no load status");
  return status;
};

function fillEmail(form: HTMLElement, email: string) {
  fireEvent.change(within(form).getByLabelText("Their email"), { target: { value: email } });
  fireEvent.change(within(form).getByLabelText("Their email again"), { target: { value: email } });
}

function fillOrganiser(form: HTMLElement) {
  fillEmail(form, "mia@example.com");
  fireEvent.change(within(form).getByLabelText("Organiser name"), { target: { value: "Neon Collective" } });
  fireEvent.change(within(form).getByLabelText("Description"), { target: { value: "Loud nights." } });
  fireEvent.click(within(form).getByLabelText("Live music"));
  fireEvent.click(within(form).getByLabelText("They asked to be invited (required)"));
}

describe("InviteForm", () => {
  it("an organiser invite: the organiser's fields, the contact email starting as theirs, and consent; sends it", async () => {
    adminCreateInvite.mockResolvedValue({ invite: invite("mia"), emailSent: true });
    const form = renderPage();
    expect(within(form).getByRole("radio", { name: /^Organiser/ })).toBeChecked();
    fillOrganiser(form);
    expect(within(form).getByLabelText("Contact email")).toHaveValue("mia@example.com");
    fireEvent.change(within(form).getByLabelText("Website"), { target: { value: "https://neon.example" } });
    await waitFor(() => expect(adminListInvites).toHaveBeenCalledTimes(1));

    const send = within(form).getByRole("button", { name: "Send invite" });
    send.focus();
    fireEvent.click(send);
    expect(within(form).getAllByRole("status").some((s) => s.textContent === "Sending the invite…")).toBe(true);
    const sent = await within(form).findByText("Invite sent to mia@example.com. The link works for 14 days.");
    expect(adminCreateInvite).toHaveBeenCalledWith(
      {
        kind: "organiser",
        email: "mia@example.com",
        consent: true,
        organiser: {
          displayName: "Neon Collective",
          contactEmail: "mia@example.com",
          description: "Loud nights.",
          categories: ["live-music"],
          websiteUrl: "https://neon.example",
        },
      },
      expect.any(Function),
    );
    // Announced once, by its live region; focus stays on Send invite.
    expect(sent.closest("[role=status]")).not.toBeNull();
    expect(sent.closest("[tabindex]")).toBeNull();
    expect(send).toHaveFocus();
    expect(within(form).getAllByRole("status").some((s) => s.textContent === "Sending the invite…")).toBe(false);
    // The form is cleared, and the list reloads.
    expect(within(form).getByLabelText("Their email")).toHaveValue("");
    expect(within(form).getByLabelText("Their email again")).toHaveValue("");
    expect(within(form).getByLabelText("They asked to be invited (required)")).not.toBeChecked();
    await waitFor(() => expect(adminListInvites).toHaveBeenCalledTimes(2));
  });

  it("asks for the address twice, and refuses two that differ (a typo would hand the invite to someone else)", async () => {
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.change(within(form).getByLabelText("Their email again"), { target: { value: "mia@exmaple.com" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    const again = within(form).getByLabelText("Their email again");
    await waitFor(() => expect(again).toHaveFocus());
    expect(again).toHaveAccessibleDescription(/^The two addresses don’t match\. Check them both\./);
    expect(adminCreateInvite).not.toHaveBeenCalled();
    // The same address in another case is the same address.
    adminCreateInvite.mockResolvedValue({ invite: invite("mia"), emailSent: true });
    fireEvent.change(again, { target: { value: "MIA@example.com" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(adminCreateInvite).toHaveBeenCalledTimes(1));
    expect(adminCreateInvite.mock.calls[0][0]).not.toHaveProperty("emailConfirm");
  });

  it("a contact email typed over stays its own", () => {
    const form = renderPage();
    fireEvent.change(within(form).getByLabelText("Their email"), { target: { value: "mia@example.com" } });
    fireEvent.change(within(form).getByLabelText("Contact email"), { target: { value: "hello@neon.example" } });
    fireEvent.change(within(form).getByLabelText("Their email"), { target: { value: "mia2@example.com" } });
    expect(within(form).getByLabelText("Contact email")).toHaveValue("hello@neon.example");
  });

  it("a member invite sends only the address and consent", async () => {
    adminCreateInvite.mockResolvedValue({ invite: invite("sam", { kind: "member", organiserName: undefined }), emailSent: false });
    const form = renderPage();
    fireEvent.click(within(form).getByRole("radio", { name: /^Member/ }));
    expect(within(form).queryByLabelText("Organiser name")).toBeNull();
    fillEmail(form, " sam@example.com ");
    fireEvent.click(within(form).getByLabelText("They asked to be invited (required)"));
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    expect(
      await within(form).findByText("Invite saved, but the email to sam@example.com didn’t send. Resend it from the list below."),
    ).toBeInTheDocument();
    expect(adminCreateInvite).toHaveBeenCalledWith({ kind: "member", email: "sam@example.com", consent: true }, expect.any(Function));
  });

  it("checks the fields first: a summary, each field described by its error, focus on the first; consent is required", async () => {
    const form = renderPage();
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    const summary = await within(form).findByRole("alert");
    expect(summary).toHaveTextContent("Fix these to send the invite:");
    expect(summary).toHaveTextContent("They asked to be invited: Confirm they asked to be invited.");
    const email = within(form).getByLabelText("Their email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(/^Enter their email address\./);
    expect(within(form).getByLabelText("Description")).toHaveAccessibleDescription("Enter a short description.");
    expect(within(form).getByLabelText("They asked to be invited (required)")).toHaveAccessibleDescription(
      /Confirm they asked to be invited\./,
    );
    expect(within(form).getByRole("button", { name: "Send invite" })).toHaveAccessibleDescription(/Fix these/);
    expect(adminCreateInvite).not.toHaveBeenCalled();
  });

  it("marks the required fields as required (the website is optional)", () => {
    const form = renderPage();
    for (const label of ["Their email", "Their email again", "Organiser name", "Contact email", "Description", "They asked to be invited (required)"]) {
      expect(within(form).getByLabelText(label)).toBeRequired();
    }
    expect(within(form).getByLabelText("Website")).not.toBeRequired();
  });

  it("offers a jump to the list (shown at narrow widths)", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Jump to invites" })).toHaveAttribute("href", "#invites-heading");
  });

  it("an expired session: signs in right there, keeping what was typed, then sends", async () => {
    adminCreateInvite.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValueOnce({ invite: invite("mia"), emailSent: true });
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again below, then send the invite.",
    );
    expect(within(form).getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(within(form).getByLabelText("Their email")).toHaveValue("mia@example.com");
    expect(within(form).getByLabelText("Organiser name")).toHaveValue("Neon Collective");
    signInAgain(form);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("admin@example.com", "pw"));
    const send = within(form).getByRole("button", { name: "Send invite" });
    await waitFor(() => expect(send).toHaveFocus());
    expect(within(form).queryByLabelText("Password")).toBeNull();
    fireEvent.click(send);
    expect(await within(form).findByText("Invite sent to mia@example.com. The link works for 14 days.")).toBeInTheDocument();
    expect(adminCreateInvite).toHaveBeenCalledTimes(2);
  });

  it("shows the server's organiser.<field> errors on their fields", async () => {
    adminCreateInvite.mockRejectedValue(
      new ApiError(400, "Check the highlighted fields.", { "organiser.description": "Keep it under 500 characters." }),
    );
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    const description = within(form).getByLabelText("Description");
    await waitFor(() => expect(description).toHaveFocus());
    expect(description).toHaveAccessibleDescription("Keep it under 500 characters.");
    expect(within(form).getByRole("alert")).toHaveTextContent("Description: Keep it under 500 characters.");
  });

  it("a 409 (already invited) is said on the email field", async () => {
    adminCreateInvite.mockRejectedValue(
      new ApiError(409, "This address already has an invite waiting.", {
        email: "This address already has an invite waiting. Resend that one instead.",
      }),
    );
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    const email = within(form).getByLabelText("Their email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription(/Resend that one instead/);
  });

  it("a 503 says clearly that invites aren't available yet, keeping what was typed", async () => {
    adminCreateInvite.mockRejectedValue(new ApiError(503, "Invites aren't available right now. Try again later."));
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    const alert = await within(form).findByRole("alert");
    // Plainly first, then why (for whoever sets the site up).
    expect(alert).toHaveTextContent(/^Invites can’t be sent yet\. Nothing was saved or sent\.This site can’t create accounts/);
    expect(alert).toHaveTextContent("SUPABASE_ADMIN_INVITE_KEY");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(form).getByLabelText("Their email")).toHaveValue("mia@example.com");
  });

  it("any other failure is said, keeping what was typed", async () => {
    adminCreateInvite.mockRejectedValue(new ApiError(429, "You've sent a lot of invites."));
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("The invite wasn’t sentYou've sent a lot of invites.");
  });
});

describe("InviteQueue", () => {
  const list = () => screen.getByRole("region", { name: "Invites waiting to be accepted" });
  const articleOf = (email: string) => screen.getByRole("article", { name: email });

  it("lists waiting invites (the default), with what each is for", async () => {
    adminListInvites.mockResolvedValue({
      items: [invite("a", { lastSendFailedAt: "2026-10-20T00:01:00.000Z" }), invite("b", { kind: "member", organiserName: undefined })],
    });
    renderPage();
    expect(await screen.findByRole("article", { name: "a@example.com" })).toHaveTextContent("Organiser: Org a");
    expect(adminListInvites).toHaveBeenCalledWith("pending", expect.any(Function));
    expect(articleOf("a@example.com")).toHaveTextContent("The last email didn’t send. Resend it.");
    expect(articleOf("b@example.com")).toHaveTextContent("Member");
    expect(within(list()).getAllByRole("article")).toHaveLength(2);
    // Full day and time, for every date.
    expect(articleOf("a@example.com")).toHaveTextContent(`Invited${formatDayTime("2026-10-20T00:00:00.000Z")}`);
    expect(articleOf("a@example.com")).toHaveTextContent(`Link works until${formatDayTime("2026-11-03T00:00:00.000Z")}`);
  });

  it("keeps the status filter in the URL", async () => {
    renderPage();
    expect(await screen.findByText("No invites waiting")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Show invites" })).getByRole("button", { name: "Expired" }));
    expect(fakeUrl.replace).toHaveBeenCalledWith("/admin/invites?status=expired", { scroll: false });
    await waitFor(() => expect(adminListInvites).toHaveBeenLastCalledWith("expired", expect.any(Function)));
    expect(await screen.findByText("No expired invites")).toBeInTheDocument();
    // The result of the filter is announced.
    await waitFor(() => expect(loadStatus()).toHaveTextContent("No expired invites."));
  });

  it("announces a filter's result with its count", async () => {
    adminListInvites.mockImplementation(async (status: string) =>
      status === "accepted" ? { items: [invite("a", { status: "accepted" }), invite("b", { status: "accepted" })], nextCursor: "c" } : { items: [] },
    );
    renderPage();
    await screen.findByText("No invites waiting");
    expect(loadStatus()).toHaveTextContent(/^$/);
    fireEvent.click(within(screen.getByRole("group", { name: "Show invites" })).getByRole("button", { name: "Accepted" }));
    await waitFor(() => expect(loadStatus()).toHaveTextContent("2 accepted invites shown, more to load."));
  });

  it("Resend a waiting invite: kept in place, announced", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminResendInvite.mockResolvedValue({ invite: invite("a", { sendCount: 2 }), emailSent: true });
    renderPage();
    fireEvent.click(within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Resend" }));
    await waitFor(() => expect(articleOf("a@example.com")).toHaveTextContent("(2 emails)"));
    expect(adminResendInvite).toHaveBeenCalledWith("a", expect.any(Function));
    // Shown as well as announced: the live region isn't screen-reader-only once it says something.
    const outcome = screen.getByText(/^Sent a new link to a@example\.com\. It works for 14 days/);
    expect(outcome).toHaveAttribute("role", "status");
    expect(outcome.className).toContain("empty:sr-only");
    expect(outcome.className).not.toMatch(/(^| )sr-only/);
  });

  it("Send a new link for an expired invite: it leaves the expired list and focus moves on", async () => {
    fakeUrl.set("status=expired");
    adminListInvites.mockResolvedValue({ items: [invite("a", { status: "expired" }), invite("b", { status: "expired" })] });
    adminResendInvite.mockResolvedValue({ invite: invite("a"), emailSent: true });
    renderPage();
    fireEvent.click(
      within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Send a new link" }),
    );
    await waitFor(() => expect(screen.queryByRole("article", { name: "a@example.com" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "b@example.com" })).toHaveFocus());
  });

  it("a resend's refusal (too soon) is said on the invite", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminResendInvite.mockRejectedValue(new ApiError(429, "This invite was sent less than a minute ago."));
    renderPage();
    fireEvent.click(within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Resend" }));
    expect(await within(articleOf("a@example.com")).findByRole("alert")).toHaveTextContent("less than a minute ago");
  });

  it("a resend's 503 says invites aren't available yet", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminResendInvite.mockRejectedValue(new ApiError(503, "Invites aren't available right now."));
    renderPage();
    fireEvent.click(within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Resend" }));
    expect(await within(articleOf("a@example.com")).findByRole("alert")).toHaveTextContent("Invites can’t be sent yet");
  });

  it("Revoke asks first (Cancel focused, and it goes back), then revokes, announces and moves focus on", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminRevokeInvite.mockResolvedValue(invite("a", { status: "revoked", revokedAt: "2026-10-25T00:00:00.000Z" }));
    renderPage();
    const article = await screen.findByRole("article", { name: "a@example.com" });
    fireEvent.click(within(article).getByRole("button", { name: "Revoke…" }));
    const question = within(article).getByRole("group", { name: /Revoke the invite for a@example\.com\?/ });
    await waitFor(() => expect(within(question).getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(adminRevokeInvite).not.toHaveBeenCalled();
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(article).getByRole("button", { name: "Revoke…" })).toHaveFocus());

    // Escape cancels too, back to Revoke….
    fireEvent.click(within(article).getByRole("button", { name: "Revoke…" }));
    const cancel = within(article).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(within(article).queryByRole("group")).toBeNull();
    await waitFor(() => expect(within(article).getByRole("button", { name: "Revoke…" })).toHaveFocus());

    fireEvent.click(within(article).getByRole("button", { name: "Revoke…" }));
    fireEvent.click(within(article).getByRole("button", { name: "Revoke invite" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "a@example.com" })).toBeNull());
    expect(adminRevokeInvite).toHaveBeenCalledWith("a", expect.any(Function));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Invites waiting to be accepted" })).toHaveFocus());
    expect(screen.getAllByRole("status").some((s) => /Revoked the invite for a@example\.com/.test(s.textContent ?? ""))).toBe(true);
    expect(await screen.findByText("No invites waiting")).toBeInTheDocument();
  });

  it("accepted and revoked invites have no actions", async () => {
    fakeUrl.set("status=accepted");
    adminListInvites.mockResolvedValue({ items: [invite("a", { status: "accepted", acceptedAt: "2026-10-22T00:00:00.000Z" })] });
    renderPage();
    const article = await screen.findByRole("article", { name: "a@example.com" });
    expect(within(article).queryByRole("button")).toBeNull();
    expect(article).toHaveTextContent("Accepted");
  });

  it("Load more adds the next page, and focus moves to the first new invite", async () => {
    adminListInvites.mockImplementation(async (_status: string, _getToken: unknown, cursor?: string) =>
      cursor ? { items: [invite("b"), invite("c")] } : { items: [invite("a")], nextCursor: "c1" },
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("article", { name: "b@example.com" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "b@example.com" })).toHaveFocus());
    expect(adminListInvites).toHaveBeenLastCalledWith("pending", expect.any(Function), "c1");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("a Load more that fails says so as an alert", async () => {
    adminListInvites.mockImplementation(async (_status: string, _getToken: unknown, cursor?: string) => {
      if (cursor) throw new ApiError(0, "Couldn't reach the server.");
      return { items: [invite("a")], nextCursor: "c1" };
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
  });

  it("a list that can't load says so, with Try again (the heading takes focus once it's loaded, and the result is announced)", async () => {
    adminListInvites.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server.")).mockResolvedValue({ items: [invite("a")] });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "a@example.com" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Invites waiting to be accepted" })).toHaveFocus());
    expect(loadStatus()).toHaveTextContent("1 invite waiting.");
  });
});

describe("InviteQueue: an expired session", () => {
  const articleOf = (email: string) => screen.getByRole("article", { name: email });

  it("loading the list: signs in right there, then loads it", async () => {
    adminListInvites.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValue({ items: [invite("a")] });
    renderPage();
    const list = await screen.findByRole("region", { name: "Invites waiting to be accepted" });
    expect(await within(list).findByRole("alert")).toHaveTextContent("Your session has expired. Sign in again below, then try again.");
    signInAgain(list);
    expect(await screen.findByRole("article", { name: "a@example.com" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("Load more: signs in beside it, then Load more works", async () => {
    adminListInvites.mockImplementation(async (_status: string, _getToken: unknown, cursor?: string) =>
      cursor ? { items: [invite("b")] } : { items: [invite("a")], nextCursor: "c1" },
    );
    renderPage();
    adminListInvites.mockRejectedValueOnce(new SessionExpiredError());
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired. Sign in again below, then load more.");
    signInAgain(screen.getByRole("region", { name: "Invites waiting to be accepted" }));
    await waitFor(() => expect(screen.queryByLabelText("Password")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("article", { name: "b@example.com" })).toBeInTheDocument();
  });

  it("Resend: signs in on the invite, then focus returns to Resend", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminResendInvite.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValue({ invite: invite("a", { sendCount: 2 }), emailSent: true });
    renderPage();
    fireEvent.click(within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Resend" }));
    expect(await within(articleOf("a@example.com")).findByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again below, then resend the invite.",
    );
    signInAgain(articleOf("a@example.com"));
    await waitFor(() => expect(within(articleOf("a@example.com")).getByRole("button", { name: "Resend" })).toHaveFocus());
    fireEvent.click(within(articleOf("a@example.com")).getByRole("button", { name: "Resend" }));
    await waitFor(() => expect(articleOf("a@example.com")).toHaveTextContent("(2 emails)"));
  });

  it("Revoke: signs in inside the confirmation, then focus returns to Revoke invite", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminRevokeInvite.mockRejectedValueOnce(new SessionExpiredError());
    renderPage();
    const article = await screen.findByRole("article", { name: "a@example.com" });
    fireEvent.click(within(article).getByRole("button", { name: "Revoke…" }));
    fireEvent.click(within(article).getByRole("button", { name: "Revoke invite" }));
    expect(await within(article).findByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again below, then revoke the invite.",
    );
    signInAgain(article);
    await waitFor(() => expect(within(article).getByRole("button", { name: "Revoke invite" })).toHaveFocus());
  });

  it("only one sign-in form at a time: the form's, then an invite's (the form keeps its words)", async () => {
    adminListInvites.mockResolvedValue({ items: [invite("a")] });
    adminCreateInvite.mockRejectedValue(new SessionExpiredError());
    adminResendInvite.mockRejectedValue(new SessionExpiredError());
    const form = renderPage();
    fillOrganiser(form);
    fireEvent.click(within(form).getByRole("button", { name: "Send invite" }));
    await within(form).findByLabelText("Password");
    fireEvent.click(within(await screen.findByRole("article", { name: "a@example.com" })).getByRole("button", { name: "Resend" }));
    await within(articleOf("a@example.com")).findByLabelText("Password");
    expect(screen.getAllByLabelText("Password")).toHaveLength(1);
    expect(form).toHaveTextContent("Your session has expired. Sign in again, then send the invite.");
  });
});

describe("OrganiserEditLog: invite_accepted", () => {
  it("names an organiser created by an accepted invite, with its status change", () => {
    render(
      <OrganiserEditLog
        edits={[{ kind: "invite_accepted", at: "2026-10-25T00:00:00.000Z", changes: { status: { old: null, new: "approved" } } }]}
      />,
    );
    const log = screen.getByText(/Recent changes \(1\)/).closest("details") as HTMLElement;
    expect(within(log).getByText("Joined by invite")).toBeInTheDocument();
    expect(within(log).getByText("Status", { selector: "dt" })).toBeInTheDocument();
    expect(log).toHaveTextContent("Approved");
  });
});
