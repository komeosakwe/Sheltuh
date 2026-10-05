// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Nav from "@/components/Nav";
import { UNREAD_POLL_MS, UnreadProvider } from "@/components/messages/UnreadProvider";
import { ApiError } from "@/lib/api/client";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const getUnreadCount = vi.fn();
vi.mock("@/lib/api/messages", () => ({
  getUnreadCount: (...args: unknown[]) => getUnreadCount(...args),
}));

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  getUnreadCount.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderNav(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <UnreadProvider>
        <Nav />
      </UnreadProvider>
    </FakeAuthProvider>,
  );
}

function messagesLinks() {
  return screen.getAllByRole("link", { name: /^Messages/, hidden: true });
}

describe("Unread badge", () => {
  it("shows the count on Messages in the desktop row and the phone menu, in the link's name, not as a live region", async () => {
    getUnreadCount.mockResolvedValue({ count: 3 });
    const { container } = renderNav();
    await advance(0);
    const links = messagesLinks();
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/messages");
      expect(link).toHaveAccessibleName("Messages, 3 unread");
      expect(link.querySelector("[data-unread-badge]")).toHaveTextContent("3");
    }
    // Background changes aren't announced.
    expect(container.querySelector("[aria-live], [role='status'], [role='alert']")).toBeNull();
    expect(getUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when nothing is unread, and caps big numbers at 99+", async () => {
    getUnreadCount.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 120 });
    renderNav();
    await advance(0);
    expect(messagesLinks()[0]).toHaveAccessibleName("Messages");
    expect(document.querySelector("[data-unread-badge]")).toBeNull();
    await advance(UNREAD_POLL_MS);
    expect(messagesLinks()[0].querySelector("[data-unread-badge]")).toHaveTextContent("99+");
    expect(messagesLinks()[0]).toHaveAccessibleName("Messages, 120 unread");
  });

  it("checks every 60s while the page is visible, and pauses while it's hidden", async () => {
    getUnreadCount.mockResolvedValue({ count: 1 });
    renderNav();
    await advance(0);
    expect(getUnreadCount).toHaveBeenCalledTimes(1);
    await advance(UNREAD_POLL_MS);
    expect(getUnreadCount).toHaveBeenCalledTimes(2);

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(UNREAD_POLL_MS * 5);
    expect(getUnreadCount).toHaveBeenCalledTimes(2);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(getUnreadCount).toHaveBeenCalledTimes(3);
  });

  it("a member who can't use messages yet (403, unverified) gets no badge, and it stops asking", async () => {
    getUnreadCount.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderNav();
    await advance(0);
    expect(document.querySelector("[data-unread-badge]")).toBeNull();
    await advance(UNREAD_POLL_MS * 3);
    expect(getUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("keeps the last count through a failed check and tries again next time", async () => {
    getUnreadCount
      .mockResolvedValueOnce({ count: 2 })
      .mockRejectedValueOnce(new ApiError(503, "Unavailable"))
      .mockResolvedValueOnce({ count: 4 });
    renderNav();
    await advance(0);
    await advance(UNREAD_POLL_MS);
    expect(messagesLinks()[0]).toHaveAccessibleName("Messages, 2 unread");
    await advance(UNREAD_POLL_MS);
    expect(messagesLinks()[0]).toHaveAccessibleName("Messages, 4 unread");
  });

  it("signed out or in demo mode: no Messages link and no requests", async () => {
    renderNav(fakeAuthValue({ status: "signed-out", email: undefined }));
    await advance(UNREAD_POLL_MS);
    expect(screen.queryAllByRole("link", { name: /^Messages/, hidden: true })).toHaveLength(0);
    cleanup();
    renderNav(fakeAuthValue({ configured: false, status: "signed-out", email: undefined }));
    await advance(UNREAD_POLL_MS);
    expect(screen.queryAllByRole("link", { name: /^Messages/, hidden: true })).toHaveLength(0);
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it("puts the count on the phone Menu button too, in its name", async () => {
    getUnreadCount.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });
    renderNav();
    await advance(0);
    const menu = screen.getByRole("button", { name: "Menu, 3 unread messages" });
    expect(menu.querySelector("[data-menu-unread]")).toHaveTextContent("3");
    await advance(UNREAD_POLL_MS);
    expect(screen.getByRole("button", { name: "Menu, 1 unread message" })).toBeInTheDocument();
  });

  it("no count, no Menu badge", async () => {
    getUnreadCount.mockResolvedValue({ count: 0 });
    renderNav();
    await advance(0);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
    expect(document.querySelector("[data-menu-unread]")).toBeNull();
  });
});
