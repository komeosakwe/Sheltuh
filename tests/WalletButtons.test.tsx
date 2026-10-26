// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WalletButtons from "@/components/tickets/WalletButtons";
import { walletPassUrl } from "@/lib/api/orders";

const ORDER = `ord_${"a1".repeat(16)}`;

afterEach(() => {
  cleanup();
});

describe("WalletButtons", () => {
  it("renders nothing when the server offers no wallet (unset, or both off)", () => {
    for (const wallet of [undefined, { google: false, apple: false }]) {
      const { container } = render(<WalletButtons sessionId={ORDER} wallet={wallet} ticketNumber={1} ticketCount={1} />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it("shows both when both are on, on any device: Apple first, each a link to its pass route for that ticket", () => {
    render(<WalletButtons sessionId={ORDER} wallet={{ google: true, apple: true }} ticketNumber={1} ticketCount={1} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Add to Apple Wallet", "Add to Google Wallet"]);
    expect(screen.getByRole("link", { name: "Add to Apple Wallet" })).toHaveAttribute(
      "href",
      `/api/orders/by-session/${ORDER}/wallet/apple?ticket=1`,
    );
    expect(screen.getByRole("link", { name: "Add to Google Wallet" })).toHaveAttribute(
      "href",
      `/api/orders/by-session/${ORDER}/wallet/google?ticket=1`,
    );
  });

  it("shows only the wallet that's on", () => {
    render(<WalletButtons sessionId={ORDER} wallet={{ google: true, apple: false }} ticketNumber={1} ticketCount={1} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Add to Google Wallet"]);
    cleanup();
    render(<WalletButtons sessionId={ORDER} wallet={{ google: false, apple: true }} ticketNumber={1} ticketCount={1} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Add to Apple Wallet"]);
  });

  it("with several tickets, each name says which ticket, starting with its visible words", () => {
    render(<WalletButtons sessionId={ORDER} wallet={{ google: true, apple: true }} ticketNumber={2} ticketCount={3} />);
    const apple = screen.getByRole("link", { name: "Add to Apple Wallet: ticket 2 of 3" });
    const google = screen.getByRole("link", { name: "Add to Google Wallet: ticket 2 of 3" });
    expect(apple).toHaveAttribute("href", walletPassUrl(ORDER, "apple", 2));
    expect(google.getAttribute("href")).toBe(`/api/orders/by-session/${ORDER}/wallet/google?ticket=2`);
    for (const link of [apple, google]) {
      expect(link.getAttribute("aria-label")!.startsWith(link.textContent!)).toBe(true);
    }
  });

  it("targets are at least 44px tall (min-h-11), never a ticket code in the URL, and the id is encoded", () => {
    render(<WalletButtons sessionId={"ord_x/../y"} wallet={{ google: true, apple: true }} ticketNumber={1} ticketCount={1} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toContain("min-h-11");
      expect(link.getAttribute("href")).toContain("ord_x%2F..%2Fy");
    }
  });
});
