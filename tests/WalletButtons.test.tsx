// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WalletButtons from "@/components/tickets/WalletButtons";
import { walletPassUrl } from "@/lib/api/orders";
import { WALLET_BADGES } from "@/lib/wallet-badges";

const ORDER = `ord_${"a1".repeat(16)}`;

afterEach(() => {
  cleanup();
});

/** What a link shows: its badge, whose words are its image's alt text (the badges have no text of their own). */
const shown = (link: HTMLElement) => link.querySelector("img")?.getAttribute("alt") ?? "";

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
    expect(links.map(shown)).toEqual(["Add to Apple Wallet", "Add to Google Wallet"]);
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
    expect(screen.getAllByRole("link").map(shown)).toEqual(["Add to Google Wallet"]);
    cleanup();
    render(<WalletButtons sessionId={ORDER} wallet={{ google: false, apple: true }} ticketNumber={1} ticketCount={1} />);
    expect(screen.getAllByRole("link").map(shown)).toEqual(["Add to Apple Wallet"]);
  });

  it("with several tickets, each name says which ticket, starting with its visible words", () => {
    render(<WalletButtons sessionId={ORDER} wallet={{ google: true, apple: true }} ticketNumber={2} ticketCount={3} />);
    const apple = screen.getByRole("link", { name: "Add to Apple Wallet: ticket 2 of 3" });
    const google = screen.getByRole("link", { name: "Add to Google Wallet: ticket 2 of 3" });
    expect(apple).toHaveAttribute("href", walletPassUrl(ORDER, "apple", 2));
    expect(google.getAttribute("href")).toBe(`/api/orders/by-session/${ORDER}/wallet/google?ticket=2`);
    for (const link of [apple, google]) {
      expect(link.getAttribute("aria-label")!.startsWith(shown(link))).toBe(true);
    }
  });

  it("targets are 44px tall (h-11), never a ticket code in the URL, and the id is encoded", () => {
    render(<WalletButtons sessionId={"ord_x/../y"} wallet={{ google: true, apple: true }} ticketNumber={1} ticketCount={1} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.querySelector("img")?.getAttribute("class")).toBe("block h-11 w-auto");
      expect(link.getAttribute("href")).toContain("ord_x%2F..%2Fy");
    }
  });

  it("both are the vendors' official badges, unmodified, never text: Apple's then Google's two-line badge", () => {
    render(<WalletButtons sessionId={ORDER} wallet={{ google: true, apple: true }} ticketNumber={2} ticketCount={3} />);
    const expected = [
      ["apple", "Add to Apple Wallet", "/wallet/badges/US-UK_Add_to_Apple_Wallet_RGB_101421.svg", "110.739", "35.016"],
      ["google", "Add to Google Wallet", "/wallet/badges/enAU_add_to_google_wallet_add-wallet-badge.svg", "199", "55"],
    ] as const;
    for (const [provider, words, src, width, height] of expected) {
      const link = screen.getByRole("link", { name: `${words}: ticket 2 of 3` });
      expect(link.getAttribute("href")).toBe(walletPassUrl(ORDER, provider, 2));
      expect(link.textContent).toBe("");
      const images = link.querySelectorAll("img");
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute("src")).toBe(src);
      expect(images[0].getAttribute("alt")).toBe(words);
      // Its own proportions: a set height and an automatic width; nothing that crops, dims or recolours it.
      expect([images[0].getAttribute("width"), images[0].getAttribute("height")]).toEqual([width, height]);
    }
    // The pair is the same height.
    expect(new Set(screen.getAllByRole("img").map((img) => img.getAttribute("class")))).toEqual(new Set(["block h-11 w-auto"]));
  });

  it("the committed artwork is the vendors' download, byte for byte", () => {
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(process.cwd(), "public", file))).digest("hex");
    expect(sha(WALLET_BADGES.apple.src)).toBe("052b3b446860fd2f9b49c2f0336038947623a5a9433ee3583585b8552ff6f506");
    expect(sha(WALLET_BADGES.google.src)).toBe("6e5b4dd71644a1df382ef0255591526859488e17e398eeae36d2f3f25b7e8efb");
  });
});
