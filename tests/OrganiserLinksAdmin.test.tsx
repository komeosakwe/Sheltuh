// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOwnerProvider } from "@/components/admin/AdminSessionExpired";
import InvitesAdmin from "@/components/admin/InvitesAdmin";
import { ApiError } from "@/lib/api/client";
import type { AdminOrganiserLinkRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime } from "@/lib/format";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { fakeUrl } from "./test-utils/fakeUrl";

// /admin/invites' organiser links (components/admin/OrganiserLinksAdmin.tsx), on the page as InvitesAdmin renders it.

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListInvites = vi.fn();
const adminListOrganiserLinks = vi.fn();
const adminCreateOrganiserLink = vi.fn();
const adminCancelOrganiserLink = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListInvites: (...args: unknown[]) => adminListInvites(...args),
  adminCreateInvite: vi.fn(),
  adminResendInvite: vi.fn(),
  adminRevokeInvite: vi.fn(),
  adminListOrganiserLinks: (...args: unknown[]) => adminListOrganiserLinks(...args),
  adminCreateOrganiserLink: (...args: unknown[]) => adminCreateOrganiserLink(...args),
  adminCancelOrganiserLink: (...args: unknown[]) => adminCancelOrganiserLink(...args),
}));

const TOKEN = "T".repeat(40) + "k_-";
const URL = `https://sheltuh.com.au/organisers/join#token=${TOKEN}`;
const CREATED_AT = "2026-10-27T00:00:00.000Z";

function link(id: string, overrides: Partial<AdminOrganiserLinkRecord> = {}): AdminOrganiserLinkRecord {
  return {
    linkId: id,
    status: "active",
    createdAt: CREATED_AT,
    createdBy: "u-admin",
    createdByEmail: "admin@example.com",
    expiresAt: "2026-11-03T00:00:00.000Z",
    ...overrides,
  };
}

const writeText = vi.fn<(text: string) => Promise<void>>();
const share = vi.fn<(data: ShareData) => Promise<void>>();

beforeEach(() => {
  fakeUrl.set("");
  fakeUrl.replace.mockReset();
  for (const fn of [adminListInvites, adminListOrganiserLinks, adminCreateOrganiserLink, adminCancelOrganiserLink, writeText, share]) {
    fn.mockReset();
  }
  adminListInvites.mockResolvedValue({ items: [] });
  adminListOrganiserLinks.mockResolvedValue({ items: [] });
  writeText.mockResolvedValue(undefined);
  share.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
});

function renderPage() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true, email: "admin@example.com", userId: "u-admin" })}>
      <AdminOwnerProvider>
        <InvitesAdmin />
      </AdminOwnerProvider>
    </FakeAuthProvider>,
  );
  return screen.getByRole("region", { name: "Organiser links" });
}

const made = (record: AdminOrganiserLinkRecord) => `Link made ${formatDayTime(record.createdAt)}`;

describe("Organiser links on /admin/invites", () => {
  it("comes first on the page, with its list", async () => {
    adminListOrganiserLinks.mockResolvedValue({
      items: [
        link("a"),
        link("b", { status: "used", usedAt: "2026-10-28T00:00:00.000Z", organiserId: "org-1", organiserName: "Neon Collective" }),
        link("c", { status: "cancelled", cancelledAt: "2026-10-28T00:00:00.000Z", createdByEmail: undefined }),
        link("d", { status: "expired" }),
      ],
    });
    const section = renderPage();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Organiser links");
    const items = await within(section).findAllByRole("article");
    expect(items.map((item) => within(item).getAllByRole("definition")[0].textContent)).toEqual([
      "Waiting to be used",
      "Used",
      "Cancelled",
      "Expired, never used",
    ]);
    expect(items[1]).toHaveTextContent("Neon Collective");
    expect(items[2]).toHaveTextContent("A former admin");
    // Only an unused, unexpired link can be cancelled.
    expect(items.map((item) => within(item).queryByRole("button", { name: "Cancel link…" }) !== null)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("Create organiser link shows the link once with Copy and Share; Copy copies it and says so", async () => {
    const created = link("new");
    adminCreateOrganiserLink.mockResolvedValue({ link: created, url: URL });
    const section = renderPage();
    expect(await within(section).findByText("No organiser links yet.")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));

    const field = await within(section).findByLabelText("Your new organiser link");
    expect(field).toHaveValue(URL);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveAccessibleDescription(/it isn’t shown again\. Anyone with this link can become an approved organiser/);
    const copy = within(section).getByRole("button", { name: "Copy link" });
    await waitFor(() => expect(copy).toHaveFocus());
    expect(within(section).getAllByRole("status").some((s) => /Link created\. Copy it now/.test(s.textContent ?? ""))).toBe(true);
    // The new link heads the list.
    expect(within(section).getByRole("article", { name: made(created) })).toBeInTheDocument();

    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
    expect(await within(section).findByText("Link copied. Paste it into a message to the organiser.")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: URL })));
    expect(share.mock.calls[0][0].text).toMatch(/You're invited to sell tickets on Sheltüh/);
    expect(await within(section).findByText("Link shared.")).toBeInTheDocument();
  });

  it("closing the share sheet without sharing says nothing", async () => {
    share.mockRejectedValue(new DOMException("closed", "AbortError"));
    adminCreateOrganiserLink.mockResolvedValue({ link: link("new"), url: URL });
    const section = renderPage();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    await within(section).findByLabelText("Your new organiser link");
    fireEvent.click(within(section).getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(within(section).getAllByRole("status").map((s) => s.textContent)).not.toContain("Link shared.");
    expect(within(section).queryByText(/Couldn’t open the share sheet/)).toBeNull();
  });

  it("without a share sheet there's no Share button", async () => {
    Reflect.deleteProperty(navigator, "share");
    adminCreateOrganiserLink.mockResolvedValue({ link: link("new"), url: URL });
    const section = renderPage();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    await within(section).findByLabelText("Your new organiser link");
    expect(within(section).queryByRole("button", { name: "Share…" })).toBeNull();
  });

  it("a copy the browser refuses selects the link to copy by hand", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    adminCreateOrganiserLink.mockResolvedValue({ link: link("new"), url: URL });
    const section = renderPage();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    const field = await within(section).findByLabelText("Your new organiser link");
    fireEvent.click(within(section).getByRole("button", { name: "Copy link" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("Couldn’t copy it. The link is selected");
    expect(field).toHaveFocus();
  });

  it("a refusal (over the allowance) is said, and no link is shown", async () => {
    adminCreateOrganiserLink.mockRejectedValue(new ApiError(429, "That's a lot of organiser links."));
    const section = renderPage();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("That's a lot of organiser links.");
    expect(within(section).queryByLabelText("Your new organiser link")).toBeNull();
  });

  it("Cancel asks first (Keep link focused; Escape keeps it), then cancels, announces and focuses the link", async () => {
    const record = link("a");
    adminListOrganiserLinks.mockResolvedValue({ items: [record] });
    adminCancelOrganiserLink.mockResolvedValue(link("a", { status: "cancelled", cancelledAt: "2026-10-28T00:00:00.000Z" }));
    const section = renderPage();
    const article = await within(section).findByRole("article", { name: made(record) });
    fireEvent.click(within(article).getByRole("button", { name: "Cancel link…" }));
    const keep = within(article).getByRole("button", { name: "Keep link" });
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.keyDown(keep, { key: "Escape" });
    const opener = within(article).getByRole("button", { name: "Cancel link…" });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(adminCancelOrganiserLink).not.toHaveBeenCalled();

    fireEvent.click(opener);
    fireEvent.click(within(article).getByRole("button", { name: "Cancel link" }));
    await waitFor(() => expect(adminCancelOrganiserLink).toHaveBeenCalledWith("a", expect.any(Function)));
    await waitFor(() => expect(within(article).getByRole("heading", { level: 4 })).toHaveFocus());
    expect(article).toHaveTextContent("Cancelled");
    expect(within(article).queryByRole("button", { name: /Cancel link/ })).toBeNull();
    expect(within(section).getAllByRole("status").some((s) => /It has stopped working/.test(s.textContent ?? ""))).toBe(true);
  });

  it("a cancel the server refuses (used meanwhile) is said on the link", async () => {
    const record = link("a");
    adminListOrganiserLinks.mockResolvedValue({ items: [record] });
    adminCancelOrganiserLink.mockRejectedValue(new ApiError(409, "Only a link that hasn't been used or expired can be cancelled."));
    const section = renderPage();
    const article = await within(section).findByRole("article", { name: made(record) });
    fireEvent.click(within(article).getByRole("button", { name: "Cancel link…" }));
    fireEvent.click(within(article).getByRole("button", { name: "Cancel link" }));
    expect(await within(article).findByRole("alert")).toHaveTextContent("Only a link that hasn't been used");
  });

  it("an expired session on create offers the page's one sign-in form here, then Create works", async () => {
    adminCreateOrganiserLink.mockRejectedValueOnce(new SessionExpiredError()).mockResolvedValue({ link: link("new"), url: URL });
    const section = renderPage();
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again below, then create the link.",
    );
    expect(screen.getAllByLabelText("Password")).toHaveLength(1);
    fireEvent.change(within(section).getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(within(section).getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.queryByLabelText("Password")).toBeNull());
    fireEvent.click(within(section).getByRole("button", { name: "Create organiser link" }));
    expect(await within(section).findByLabelText("Your new organiser link")).toHaveValue(URL);
  });

  it("a list that can't load says so, with Try again", async () => {
    adminListOrganiserLinks.mockRejectedValueOnce(new ApiError(0, "Network error.")).mockResolvedValue({ items: [link("a")] });
    const section = renderPage();
    expect(await within(section).findByRole("alert")).toHaveTextContent("Network error.");
    fireEvent.click(within(section).getByRole("button", { name: "Try again" }));
    expect(await within(section).findByRole("article")).toBeInTheDocument();
  });

  it("Load more links adds the next page and focuses its first link", async () => {
    adminListOrganiserLinks.mockImplementation(async (_getToken: unknown, cursor?: string) =>
      cursor
        ? { items: [link("b", { createdAt: "2026-10-20T00:00:00.000Z" })] }
        : { items: [link("a")], nextCursor: "c1" },
    );
    const section = renderPage();
    fireEvent.click(await within(section).findByRole("button", { name: "Load more links" }));
    const next = await within(section).findByRole("heading", { name: made(link("b", { createdAt: "2026-10-20T00:00:00.000Z" })) });
    await waitFor(() => expect(next).toHaveFocus());
    expect(adminListOrganiserLinks).toHaveBeenLastCalledWith(expect.any(Function), "c1");
  });
});
