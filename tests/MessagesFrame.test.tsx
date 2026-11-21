// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessagesFrame from "@/components/messages/MessagesFrame";

/**
 * /messages as Latte's split view (demo mode: the sample conversations, no API): the title, the
 * conversation list beside the open conversation (the page), the open one marked in the list, and
 * /messages/blocked left as a page of its own.
 */

let segment: string | null = null;
vi.mock("next/navigation", () => ({
  usePathname: () => (segment ? `/messages/${segment}` : "/messages"),
  useSelectedLayoutSegment: () => segment,
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  segment = null;
});
afterEach(cleanup);

function renderFrame() {
  return render(
    <MessagesFrame>
      <section aria-label="Open conversation">thread</section>
    </MessagesFrame>,
  );
}

describe("MessagesFrame", () => {
  it("on /messages: the title is the h1, the list sits beside the page, nothing is marked open", () => {
    renderFrame();
    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Blocked members" })).toHaveAttribute("href", "/messages/blocked");
    const list = screen.getByRole("list", { name: "Conversations" });
    const page = screen.getByRole("region", { name: "Open conversation" });
    // The list comes first (above on phones, on the left from 768px), in one row with the page.
    expect(list.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(list).getAllByRole("link").length).toBeGreaterThan(0);
    expect(list.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("on a conversation: marks it in the list, and leaves the h1 to the thread", () => {
    segment = "priya-r";
    renderFrame();
    expect(screen.queryByRole("heading", { level: 1, name: "Messages" })).toBeNull();
    expect(screen.getByText("Messages", { selector: "p" })).toHaveClass("heading-page");
    const current = within(screen.getByRole("list", { name: "Conversations" })).getByRole("link", {
      current: "page",
    });
    expect(current).toHaveAttribute("href", "/messages/priya-r");
    expect(current).toHaveTextContent("Priya R.");
  });

  it("leaves /messages/blocked as a page of its own", () => {
    segment = "blocked";
    renderFrame();
    expect(screen.queryByRole("list", { name: "Conversations" })).toBeNull();
    expect(screen.queryByText("Messages")).toBeNull();
    expect(screen.getByRole("region", { name: "Open conversation" })).toBeInTheDocument();
  });
});
