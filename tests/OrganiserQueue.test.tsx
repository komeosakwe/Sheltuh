// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserQueue from "@/components/admin/OrganiserQueue";
import { ApiError } from "@/lib/api/client";
import { SessionExpiredError } from "@/lib/auth/session-token";
import type { AdminOrganiserRecord, OrganiserStatus } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const adminListOrganisers = vi.fn();
const adminApproveOrganiser = vi.fn();
const adminRejectOrganiser = vi.fn();
const adminSuspendOrganiser = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
  adminApproveOrganiser: (...args: unknown[]) => adminApproveOrganiser(...args),
  adminRejectOrganiser: (...args: unknown[]) => adminRejectOrganiser(...args),
  adminSuspendOrganiser: (...args: unknown[]) => adminSuspendOrganiser(...args),
}));

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  adminListOrganisers.mockReset();
  adminApproveOrganiser.mockReset();
  adminRejectOrganiser.mockReset();
  adminSuspendOrganiser.mockReset();
});
afterEach(cleanup);

const WARNING =
  "This unpublishes all of their events and hides their public profile. Paid tickets stay valid; refunds are handled in Stripe. They can reapply; you’ll see it under Pending.";

function organiser(id: string, overrides: Partial<AdminOrganiserRecord> = {}): AdminOrganiserRecord {
  return {
    ownerUserId: `user-${id}`,
    organiserId: id,
    displayName: `Org ${id}`,
    contactEmail: `${id}@example.com`,
    description: "Loud nights in small rooms.",
    categories: ["live-music"],
    status: "approved",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    recentEdits: [],
    ...overrides,
  };
}

/** Lists `items` for `status`, and nothing for any other status. */
function listing(status: OrganiserStatus, items: AdminOrganiserRecord[]) {
  adminListOrganisers.mockImplementation(async (asked: OrganiserStatus) => ({ items: asked === status ? items : [] }));
}

function renderQueue() {
  const auth = fakeAuthValue({ isAdmin: true });
  render(
    <FakeAuthProvider value={auth}>
      <OrganiserQueue />
    </FakeAuthProvider>,
  );
  return auth;
}

function articleOf(name: string): HTMLElement {
  const article = screen.getByRole("heading", { name }).closest("article");
  if (!article) throw new Error(`no article for ${name}`);
  return article;
}

const TAB_LABELS: Record<OrganiserStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected & suspended",
};

/** The visible result of the last action (there's also a screen-reader-only one for loads). */
function actionStatus(): HTMLElement {
  const region = document.getElementById("organisers-announcement");
  if (!region) throw new Error("no announcement region");
  return region;
}

function loadStatus(): HTMLElement {
  const region = document.getElementById("organisers-load-status");
  if (!region) throw new Error("no load status region");
  return region;
}

/** Renders the queue (pending first, listed empty) and switches to `status`. */
async function showStatus(status: Exclude<OrganiserStatus, "pending">) {
  renderQueue();
  await screen.findByText("Nothing to review");
  fireEvent.click(screen.getByRole("button", { name: TAB_LABELS[status] }));
  await waitFor(() => expect(adminListOrganisers).toHaveBeenLastCalledWith(status, expect.any(Function)));
}

async function showApproved() {
  await showStatus("approved");
  await screen.findByRole("heading", { name: /^Approved organisers/ });
}

async function openSuspend(name: string) {
  await screen.findByRole("heading", { name });
  fireEvent.click(within(articleOf(name)).getByRole("button", { name: "Suspend…" }));
  const dialog = await screen.findByRole("dialog", { name: `Suspend ${name}?` });
  return dialog;
}

describe("Admin organisers: statuses", () => {
  it("starts on pending applications and can reach approved and rejected organisers", async () => {
    listing("approved", [organiser("a1")]);
    renderQueue();
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(adminListOrganisers).toHaveBeenCalledWith("pending", expect.any(Function));
    expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    expect(await screen.findByRole("heading", { name: "Org a1" })).toBeInTheDocument();
    expect(adminListOrganisers).toHaveBeenLastCalledWith("approved", expect.any(Function));
    expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Approved organisers");

    fireEvent.click(screen.getByRole("button", { name: "Rejected & suspended" }));
    expect(await screen.findByText("None yet")).toBeInTheDocument();
    expect(adminListOrganisers).toHaveBeenLastCalledWith("rejected", expect.any(Function));
  });

  it("shows a load failure with a way to try again", async () => {
    adminListOrganisers
      .mockRejectedValueOnce(new ApiError(500, "boom"))
      .mockResolvedValueOnce({ items: [organiser("p1", { status: "pending" })] });
    renderQueue();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load organisers.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Org p1" })).toBeInTheDocument();
  });
});

describe("Admin organisers: website and social handles", () => {
  it.each<OrganiserStatus>(["pending", "approved", "rejected"])(
    "shows the full website as text, a safe link to it, and all four handles (%s)",
    async (status) => {
      listing(status, [
        organiser("o1", {
          status,
          websiteUrl: "https://www.northside.example/a-very/long/path?q=1#frag",
          instagramHandle: "northside.noise",
          tiktokHandle: "northside_noise",
          facebookPage: "northsidenoise",
          xHandle: "nsnoise",
        }),
      ]);
      if (status === "pending") renderQueue();
      else await showStatus(status);
      await screen.findByRole("heading", { name: "Org o1" });
      const article = articleOf("Org o1");
      // The raw URL, exactly as stored, as plain text.
      expect(within(article).getByText("https://www.northside.example/a-very/long/path?q=1#frag").tagName).toBe("SPAN");
      const link = within(article).getByRole("link", { name: "Open northside.example (opens in a new tab)" });
      expect(link).toHaveAttribute("href", "https://www.northside.example/a-very/long/path?q=1#frag");
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
      expect(link).toHaveAttribute("target", "_blank");
      expect(article).toHaveTextContent("Instagram@northside.noise");
      expect(article).toHaveTextContent("TikTok@northside_noise");
      expect(article).toHaveTextContent("Facebookfacebook.com/northsidenoise");
      expect(article).toHaveTextContent("X@nsnoise");
    },
  );

  it("says when a website or handle isn't given, and never links a non-http(s) value", async () => {
    adminListOrganisers.mockResolvedValue({
      items: [
        organiser("o1", { status: "pending", websiteUrl: "javascript:alert(1)" }),
        organiser("o2", { status: "pending" }),
      ],
    });
    renderQueue();
    await screen.findByRole("heading", { name: "Org o1" });
    const first = articleOf("Org o1");
    expect(within(first).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(within(first).queryByRole("link", { name: /^Open/ })).toBeNull();
    // The contact email is a mailto link.
    expect(within(first).getByRole("link", { name: "o1@example.com" })).toHaveAttribute("href", "mailto:o1@example.com");
    expect(within(articleOf("Org o2")).getAllByText("Not given")).toHaveLength(5);
  });
});

describe("Admin organisers: suspending", () => {
  it("only offers Suspend… to approved organisers", async () => {
    adminListOrganisers.mockImplementation(async (status: OrganiserStatus) => ({
      items: [organiser(`${status}-1`, { status })],
    }));
    renderQueue();
    await screen.findByRole("heading", { name: "Org pending-1" });
    expect(screen.queryByRole("button", { name: "Suspend…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rejected & suspended" }));
    await screen.findByRole("heading", { name: "Org rejected-1" });
    expect(screen.queryByRole("button", { name: "Suspend…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    await screen.findByRole("heading", { name: "Org approved-1" });
    expect(screen.getByRole("button", { name: "Suspend…" })).toBeInTheDocument();
  });

  it("opens a dialog with the warning, focused on the reason (counted to 500)", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    expect(dialog).toHaveAccessibleDescription(WARNING);
    const reason = within(dialog).getByLabelText("Reason (shown to the organiser)");
    await waitFor(() => expect(reason).toHaveFocus());
    expect(dialog).toHaveTextContent("0/500");
    fireEvent.change(reason, { target: { value: "Fake events" } });
    expect(dialog).toHaveTextContent("11/500");
  });

  it("requires a reason, and refuses one over 500 characters, without calling the API", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    const reason = within(dialog).getByLabelText("Reason (shown to the organiser)");
    const submit = within(dialog).getByRole("button", { name: "Suspend organiser" });

    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription("Enter a reason.");

    fireEvent.change(reason, { target: { value: "x".repeat(501) } });
    expect(reason).not.toHaveAttribute("aria-invalid");
    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAccessibleDescription(/^Keep it to 500 characters or fewer\./);
    expect(adminSuspendOrganiser).not.toHaveBeenCalled();
  });

  it("suspends: removes them from the list, announces the count and focuses the next organiser", async () => {
    listing("approved", [organiser("a1"), organiser("a2")]);
    adminSuspendOrganiser.mockResolvedValue({
      organiser: organiser("a1", { status: "rejected" }),
      eventsUnpublished: 3,
      submissionsRejected: 0,
    });
    const auth = renderQueue();
    await screen.findByText("Nothing to review");
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), {
      target: { value: "  Selling fake tickets  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Org a1" })).toBeNull());
    expect(adminSuspendOrganiser).toHaveBeenCalledWith("a1", "Selling fake tickets", auth.getAccessToken);
    expect(actionStatus()).toHaveTextContent("Suspended Org a1. 3 events unpublished.");
    // The dialog is closed by an effect (dialog.close()) after the commit that removed Org a1.
    // That commit came from a resolved promise, not an act()-wrapped event, so React runs the
    // effect in a later scheduler task: under load the waitFor above can resolve in between.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Org a2" })).toHaveFocus());
  });

  it("the last one suspended: the list heading takes focus; singular counts and rejected submissions are said", async () => {
    listing("approved", [organiser("a1")]);
    adminSuspendOrganiser.mockResolvedValue({
      organiser: organiser("a1", { status: "rejected" }),
      eventsUnpublished: 1,
      submissionsRejected: 2,
    });
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    expect(await screen.findByText("No approved organisers")).toBeInTheDocument();
    expect(actionStatus()).toHaveTextContent(
      "Suspended Org a1. 1 event unpublished. 2 submissions rejected.",
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Approved organisers (0)" })).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Approved organisers (0)" })).toHaveAccessibleDescription(
      "Suspended Org a1. 1 event unpublished. 2 submissions rejected.",
    );
  });

  it("Cancel closes the dialog and returns focus to Suspend…", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Suspend…" })).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Org a1" })).toBeInTheDocument();
    expect(adminSuspendOrganiser).not.toHaveBeenCalled();
  });

  it("Escape (the dialog's own close) also returns focus to Suspend…, and reopening starts fresh", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "draft" } });
    (dialog as HTMLDialogElement).close();
    await waitFor(() => expect(screen.getByRole("button", { name: "Suspend…" })).toHaveFocus());
    const again = await openSuspend("Org a1");
    expect(within(again).getByLabelText("Reason (shown to the organiser)")).toHaveValue("");
  });

  it("shows the API's reason error on the field", async () => {
    listing("approved", [organiser("a1")]);
    adminSuspendOrganiser.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { reason: "Must be 500 characters or fewer." }),
    );
    await showApproved();
    const dialog = await openSuspend("Org a1");
    const reason = within(dialog).getByLabelText("Reason (shown to the organiser)");
    fireEvent.change(reason, { target: { value: "ok" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    await waitFor(() => expect(reason).toHaveAccessibleDescription("Must be 500 characters or fewer."));
    expect(reason).toHaveFocus();
    expect(reason).toHaveValue("ok");
  });

  it.each([
    [409, "Only an approved organiser can be suspended — this one may already have been suspended."],
    [404, "Organiser not found."],
  ])("%i: says so in the dialog; closing it takes them off the list", async (status, message) => {
    listing("approved", [organiser("a1"), organiser("a2")]);
    adminSuspendOrganiser.mockRejectedValue(new ApiError(status, message));
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));

    const notice = await within(dialog).findByText(new RegExp(message));
    const problem = notice.closest("[tabindex='-1']") as HTMLElement;
    await waitFor(() => expect(problem).toHaveFocus());
    expect(within(dialog).queryByRole("button", { name: "Suspend organiser" })).toBeNull();
    expect(within(dialog).queryByLabelText("Reason (shown to the organiser)")).toBeNull();
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveAccessibleDescription(new RegExp(message));
    // Still listed until the admin has read it.
    expect(screen.getByRole("heading", { name: "Org a1" })).toBeInTheDocument();

    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Org a1" })).toBeNull());
    expect(actionStatus()).toHaveTextContent("Org a1 is no longer approved");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Org a2" })).toHaveFocus());
  });

  it("other failures stay in the dialog (described and focused) so it can be tried again", async () => {
    listing("approved", [organiser("a1")]);
    adminSuspendOrganiser
      .mockRejectedValueOnce(new ApiError(500, "Internal"))
      .mockResolvedValueOnce({
        organiser: organiser("a1", { status: "rejected" }),
        eventsUnpublished: 0,
        submissionsRejected: 0,
      });
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    const submit = within(dialog).getByRole("button", { name: "Suspend organiser" });
    fireEvent.click(submit);
    const notice = await within(dialog).findByText("Couldn’t suspend them. Try again.");
    await waitFor(() => expect(notice.closest("[tabindex='-1']")).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Suspend organiser" })).toHaveAccessibleDescription(
      `${WARNING} Couldn’t suspend them. Try again.`,
    );
    expect(within(dialog).getByLabelText("Reason (shown to the organiser)")).toHaveValue("Spam");

    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    expect(await screen.findByText("No approved organisers")).toBeInTheDocument();
    expect(actionStatus()).toHaveTextContent("Suspended Org a1. 0 events unpublished.");
  });
});

describe("Admin organisers: recent profile changes", () => {
  const longBio = `${"word ".repeat(40)}end`;

  it("lists entries newest first, collapsed, with old → new per field and the takedown reason", async () => {
    listing("rejected", [
      organiser("r1", {
        status: "rejected",
        rejectionReason: "Selling fake tickets",
        recentEdits: [
          {
            kind: "suspended",
            at: "2026-09-26T09:00:00.000Z",
            changes: { status: { old: "approved", new: "rejected" } },
            reason: "Selling fake tickets",
          },
          {
            kind: "profile_edit",
            at: "2026-09-20T02:30:00.000Z",
            changes: {
              xHandle: { old: null, new: "nsnoise" },
              websiteUrl: { old: "https://old.example", new: "https://new.example" },
              description: { old: "Short.", new: longBio },
            },
          },
        ],
      }),
    ]);
    await showStatus("rejected");
    await screen.findByRole("heading", { name: "Org r1" });
    const article = articleOf("Org r1");

    const summary = within(article).getByText(/Recent changes \(2\)/);
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    const entries = within(details as HTMLElement).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    // Newest first, as the API sends them.
    expect(entries[0]).toHaveTextContent("Suspended");
    expect(entries[0]).toHaveTextContent(formatDayTime("2026-09-26T09:00:00.000Z"));
    expect(entries[0]).toHaveTextContent("Reason: Selling fake tickets");
    expect(entries[0]).toHaveTextContent(/Status\s*Before: Approved\s*After: Suspended/);
    expect(within(entries[0]).getByText(formatDayTime("2026-09-26T09:00:00.000Z"))).toHaveAttribute(
      "datetime",
      "2026-09-26T09:00:00.000Z",
    );

    expect(entries[1]).toHaveTextContent("Profile edit");
    // Melbourne time: 02:30 UTC is 12:30 pm AEST.
    expect(entries[1]).toHaveTextContent(/, 12:30 pm/);
    // In form order (bio, website, then handles), whatever order the API sent them in.
    const terms = within(entries[1])
      .getAllByRole("term")
      .map((t) => t.textContent);
    expect(terms).toEqual(["Bio", "Website", "X"]);
    expect(entries[1]).toHaveTextContent(/Website\s*Before: https:\/\/old\.example\s*After: https:\/\/new\.example/);
    expect(entries[1]).toHaveTextContent(/X\s*Before: \(none\)\s*After: @nsnoise/);
  });

  it("cuts a long value short, with a button that shows all of it", async () => {
    listing("approved", [
      organiser("a1", {
        recentEdits: [
          {
            kind: "profile_edit",
            at: "2026-09-20T02:30:00.000Z",
            changes: { description: { old: "Short.", new: longBio } },
          },
        ],
      }),
    ]);
    await showApproved();
    const article = articleOf("Org a1");
    expect(article).not.toHaveTextContent(longBio);
    const toggle = within(article).getByRole("button", { name: `Show all ${longBio.length} characters of the new Bio` });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(article).toHaveTextContent(`${longBio.slice(0, 120)}…`);
    fireEvent.click(toggle);
    expect(article).toHaveTextContent(longBio);
    expect(within(article).getByRole("button", { name: "Show less of the new Bio" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says when there are no recent changes", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    expect(within(articleOf("Org a1")).getByText("No recent changes.")).toBeInTheDocument();
    expect(within(articleOf("Org a1")).queryByText(/Recent changes \(/)).toBeNull();
  });
});

describe("Admin organisers: reviewing applications", () => {
  it("Approve removes the application, announces it and focuses the next", async () => {
    listing("pending", [organiser("p1", { status: "pending" }), organiser("p2", { status: "pending" })]);
    adminApproveOrganiser.mockResolvedValue(organiser("p1"));
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(within(articleOf("Org p1")).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Org p1" })).toBeNull());
    expect(adminApproveOrganiser).toHaveBeenCalledWith("p1", expect.any(Function));
    expect(actionStatus()).toHaveTextContent("Approved Org p1.");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Org p2" })).toHaveFocus());
  });

  it("Reject asks for a reason (focused), then rejects; failures are shown", async () => {
    listing("pending", [organiser("p1", { status: "pending" })]);
    adminRejectOrganiser
      .mockRejectedValueOnce(new ApiError(400, "Couldn’t reject that."))
      .mockResolvedValueOnce(organiser("p1", { status: "rejected" }));
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const reason = screen.getByLabelText("Reason (shown to the applicant)");
    await waitFor(() => expect(reason).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(reason).toHaveAccessibleDescription("Enter a reason.");
    expect(adminRejectOrganiser).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: " Not a creative events organiser " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t reject that.");
    expect(reason).toHaveValue(" Not a creative events organiser ");

    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(adminRejectOrganiser).toHaveBeenLastCalledWith(
      "p1",
      "Not a creative events organiser",
      expect.any(Function),
    );
    expect(actionStatus()).toHaveTextContent("Rejected Org p1.");
  });

  it("Cancel on a rejection returns focus to Reject", async () => {
    listing("pending", [organiser("p1", { status: "pending" })]);
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).toHaveFocus());
  });
});

/** A promise and the means to settle it from the test. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Admin organisers: a suspend in flight", () => {
  it("Escape doesn't close the dialog while Suspending…", async () => {
    listing("approved", [organiser("a1")]);
    const pending = deferred<never>();
    adminSuspendOrganiser.mockReturnValue(pending.promise);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    await within(dialog).findByRole("button", { name: "Suspending…" });

    const escape = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute("open");

    pending.reject(new ApiError(500, "boom"));
    expect(await within(dialog).findByText("Couldn’t suspend them. Try again.")).toBeInTheDocument();
    // Once it's settled, Escape closes it again.
    const later = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("a failure after the dialog was forced closed is shown as an alert", async () => {
    listing("approved", [organiser("a1")]);
    const pending = deferred<never>();
    adminSuspendOrganiser.mockReturnValue(pending.promise);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    await within(dialog).findByRole("button", { name: "Suspending…" });
    (dialog as HTMLDialogElement).close(); // A browser can force it (a second Escape).
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pending.reject(new ApiError(500, "boom"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t suspend Org a1. Open Suspend… to try again.");
    expect(screen.getByRole("heading", { name: "Org a1" })).toBeInTheDocument();
  });

  it("a 409 after the dialog was forced closed takes them off the list, and says so", async () => {
    listing("approved", [organiser("a1"), organiser("a2")]);
    const pending = deferred<never>();
    adminSuspendOrganiser.mockReturnValue(pending.promise);
    await showApproved();
    const dialog = await openSuspend("Org a1");
    fireEvent.change(within(dialog).getByLabelText("Reason (shown to the organiser)"), { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));
    await within(dialog).findByRole("button", { name: "Suspending…" });
    (dialog as HTMLDialogElement).close();

    pending.reject(new ApiError(409, "Only an approved organiser can be suspended."));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Org a1" })).toBeNull());
    expect(actionStatus()).toHaveTextContent("Org a1 is no longer approved");
  });

  it("an expired session: signs in inside the dialog, keeping the reason, then suspends", async () => {
    listing("approved", [organiser("a1")]);
    adminSuspendOrganiser.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValueOnce({
      organiser: organiser("a1", { status: "rejected" }),
      eventsUnpublished: 0,
      submissionsRejected: 0,
    });
    const auth = fakeAuthValue({ isAdmin: true, email: "admin@example.com" });
    render(
      <FakeAuthProvider value={auth}>
        <OrganiserQueue />
      </FakeAuthProvider>,
    );
    await screen.findByText("Nothing to review");
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    const dialog = await openSuspend("Org a1");
    const reason = within(dialog).getByLabelText("Reason (shown to the organiser)");
    fireEvent.change(reason, { target: { value: "Spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend organiser" }));

    expect(await within(dialog).findByText(/Your session has expired\. Sign in again below, then suspend them\./)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(reason).toHaveValue("Spam");
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("admin@example.com", "pw"));
    const submit = within(dialog).getByRole("button", { name: "Suspend organiser" });
    await waitFor(() => expect(submit).toHaveFocus());
    expect(within(dialog).queryByLabelText("Password")).toBeNull();

    fireEvent.click(submit);
    expect(await screen.findByText("No approved organisers")).toBeInTheDocument();
    expect(adminSuspendOrganiser).toHaveBeenLastCalledWith("a1", "Spam", auth.getAccessToken);
  });
});

describe("Admin organisers: rejected and suspended", () => {
  const suspendedAt = "2026-10-20T04:10:00.000Z";

  it("tells a suspended organiser from a rejected one", async () => {
    listing("rejected", [
      organiser("s1", {
        status: "rejected",
        rejectionReason: "Selling fake tickets",
        reviewedAt: suspendedAt,
        recentEdits: [
          {
            kind: "suspended",
            at: suspendedAt,
            changes: { status: { old: "approved", new: "rejected" } },
            reason: "Selling fake tickets",
          },
        ],
      }),
      organiser("r1", { status: "rejected", rejectionReason: "Not events", reviewedAt: "2026-10-01T00:00:00.000Z" }),
      // Suspended once, reapplied, and rejected later: a rejection now.
      organiser("r2", {
        status: "rejected",
        rejectionReason: "Still not events",
        reviewedAt: "2026-10-21T00:00:00.000Z",
        recentEdits: [
          {
            kind: "suspended",
            at: suspendedAt,
            changes: { status: { old: "approved", new: "rejected" } },
            reason: "Spam",
          },
        ],
      }),
    ]);
    await showStatus("rejected");
    await screen.findByRole("heading", { name: "Org s1" });

    const suspended = articleOf("Org s1");
    expect(within(suspended).getByText("Suspended", { selector: "p.eyebrow" })).toHaveClass("text-danger");
    expect(suspended).toHaveTextContent(`Suspended ${formatDayTime(suspendedAt)} · Reason: Selling fake tickets`);
    expect(suspended).not.toHaveTextContent("Reason given");

    const rejected = articleOf("Org r1");
    expect(within(rejected).getByText("Rejected", { selector: "p.eyebrow" })).toBeInTheDocument();
    expect(rejected).toHaveTextContent(`Rejected ${formatDayTime("2026-10-01T00:00:00.000Z")} · Reason: Not events`);
    expect(within(rejected).queryByText("Suspended", { selector: "p.eyebrow" })).toBeNull();

    expect(within(articleOf("Org r2")).getByText("Rejected", { selector: "p.eyebrow" })).toBeInTheDocument();
    expect(articleOf("Org r2")).toHaveTextContent("Reason: Still not events");
  });

  it("no status eyebrow for pending or approved organisers", async () => {
    listing("approved", [organiser("a1")]);
    await showApproved();
    expect(within(articleOf("Org a1")).queryByText(/^(Suspended|Rejected)$/)).toBeNull();
  });
});

describe("Admin organisers: already reviewed", () => {
  it.each([
    [409, "approve"],
    [404, "approve"],
    [409, "reject"],
    [404, "reject"],
  ] as const)("%i on %s: takes it off the list and says why", async (status, action) => {
    listing("pending", [organiser("p1", { status: "pending" }), organiser("p2", { status: "pending" })]);
    adminApproveOrganiser.mockRejectedValue(new ApiError(status, "Already reviewed."));
    adminRejectOrganiser.mockRejectedValue(new ApiError(status, "Already reviewed."));
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    const article = articleOf("Org p1");
    if (action === "approve") {
      fireEvent.click(within(article).getByRole("button", { name: "Approve" }));
    } else {
      fireEvent.click(within(article).getByRole("button", { name: "Reject" }));
      fireEvent.change(within(article).getByLabelText("Reason (shown to the applicant)"), {
        target: { value: "Nope" },
      });
      fireEvent.click(within(article).getByRole("button", { name: "Confirm rejection" }));
    }
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Org p1" })).toBeNull());
    expect(actionStatus()).toHaveTextContent("Org p1 was already reviewed, so it’s been taken off this list.");
    const next = screen.getByRole("heading", { name: "Org p2" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(next).toHaveAccessibleDescription("Org p1 was already reviewed, so it’s been taken off this list.");
  });
});

describe("Admin organisers: an expired session while reviewing", () => {
  it("signs in right there, keeping the rejection reason, then the rejection can be confirmed", async () => {
    listing("pending", [organiser("p1", { status: "pending" })]);
    adminRejectOrganiser
      .mockRejectedValueOnce(new SessionExpiredError())
      .mockResolvedValueOnce(organiser("p1", { status: "rejected" }));
    const auth = renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const reason = screen.getByLabelText("Reason (shown to the applicant)");
    fireEvent.change(reason, { target: { value: "Not events" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again below, then confirm the rejection.",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("organiser@example.com");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm rejection" })).toHaveFocus());
    expect(auth.signIn).toHaveBeenCalled();
    expect(reason).toHaveValue("Not events");
    expect(screen.queryByLabelText("Password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(adminRejectOrganiser).toHaveBeenLastCalledWith("p1", "Not events", expect.any(Function));
  });

  it("only one sign-in form is shown when two actions hit an expired session", async () => {
    listing("pending", [organiser("p1", { status: "pending" }), organiser("p2", { status: "pending" })]);
    adminApproveOrganiser.mockRejectedValue(new SessionExpiredError());
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(within(articleOf("Org p1")).getByRole("button", { name: "Approve" }));
    await within(articleOf("Org p1")).findByLabelText("Password");
    fireEvent.click(within(articleOf("Org p2")).getByRole("button", { name: "Approve" }));
    await within(articleOf("Org p2")).findByLabelText("Password");
    expect(screen.getAllByLabelText("Password")).toHaveLength(1);
    expect(articleOf("Org p1")).toHaveTextContent("Your session has expired. Sign in again, then approve this application.");
  });
});

describe("Admin organisers: loading", () => {
  it("announces each filter's result and shows the count in the heading", async () => {
    adminListOrganisers.mockImplementation(async (status: OrganiserStatus) => ({
      items:
        status === "pending"
          ? [organiser("p1", { status }), organiser("p2", { status }), organiser("p3", { status })]
          : [],
    }));
    renderQueue();
    expect(await screen.findByRole("heading", { name: "Pending applications (3)" })).toBeInTheDocument();
    // The first page load isn't announced; a chosen filter is.
    expect(loadStatus()).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    expect(await screen.findByRole("heading", { name: "Approved organisers (0)" })).toBeInTheDocument();
    await waitFor(() => expect(loadStatus()).toHaveTextContent("No approved organisers"));

    fireEvent.click(screen.getByRole("button", { name: "Pending" }));
    await waitFor(() => expect(loadStatus()).toHaveTextContent("3 pending applications."));
  });

  it("says when there are more to load", async () => {
    adminListOrganisers.mockImplementation(async (status: OrganiserStatus) =>
      status === "approved" ? { items: [organiser("a1")], nextCursor: "c1" } : { items: [] },
    );
    await showStatus("approved");
    expect(await screen.findByRole("heading", { name: "Approved organisers (1+)" })).toBeInTheDocument();
    await waitFor(() => expect(loadStatus()).toHaveTextContent("1 approved organiser shown, more to load."));
  });

  it("a failed Load more is an alert, and Load more can be tried again", async () => {
    adminListOrganisers
      .mockResolvedValueOnce({ items: [organiser("p1", { status: "pending" })], nextCursor: "c1" })
      .mockRejectedValueOnce(new ApiError(500, "boom"))
      .mockResolvedValueOnce({ items: [organiser("p2", { status: "pending" })] });
    renderQueue();
    await screen.findByRole("heading", { name: "Org p1" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load more organisers.");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Org p2" })).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
