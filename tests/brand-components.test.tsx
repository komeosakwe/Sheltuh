// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DotsMark, { DotsLoader } from "@/components/brand/DotsMark";
import UMark from "@/components/brand/UMark";
import Wordmark from "@/components/brand/Wordmark";
import { DOTS_MARK, U_MARK, WORDMARK, WORDMARK_LOWERCASE, type BrandMark } from "@/components/brand/marks";
import Footer from "@/components/Footer";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { resetInstallDismissedForTests } from "@/lib/pwa/install";
import { UA } from "./test-utils/user-agents";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

afterEach(cleanup);

const root = path.resolve(import.meta.dirname, "..");

/** The path commands, in order, and the coordinates rounded to 0.01, as marks.ts stores them. */
function shape(d: string) {
  return {
    commands: d.replace(/[^MLCZ]/g, ""),
    numbers: (d.match(/-?\d*\.?\d+/g) ?? []).map((n) => Math.round(Number(n) * 100) / 100),
  };
}

describe("brand marks (components/brand/marks.ts)", () => {
  it.each([
    ["sheltuh-wordmark.svg", WORDMARK],
    ["sheltuh-wordmark-lowercase.svg", WORDMARK_LOWERCASE],
    ["sheltuh-u.svg", U_MARK],
    ["sheltuh-dots.svg", DOTS_MARK],
  ] as [string, BrandMark][])("match the official vector public/brand/%s", (file, mark) => {
    const svg = readFileSync(path.join(root, "public", "brand", file), "utf8");
    expect(mark.viewBox).toBe(svg.match(/viewBox="([^"]+)"/)?.[1]);
    const official = [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => shape(match[1]));
    expect(mark.paths.map(shape)).toEqual(official);
    const [, , width, height] = mark.viewBox.split(" ").map(Number);
    expect(mark.ratio).toBeCloseTo(width / height, 2);
  });
});

describe("logo components", () => {
  it("are decorative by default, so the name sits on the parent link", () => {
    const { container } = render(
      <Link href="/" aria-label="Sheltüh home">
        <Wordmark className="h-5 w-auto" />
      </Link>,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("viewBox", WORDMARK.viewBox);
    expect(screen.getByRole("link", { name: "Sheltüh home" })).toBeInTheDocument();
  });

  it("take an accessible name when they stand alone", () => {
    render(
      <>
        <Wordmark label="Sheltüh" />
        <Wordmark lowercase label="sheltüh lowercase" />
        <UMark label="Sheltüh ü" />
        <DotsMark label="Two dots" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Sheltüh" })).toHaveAttribute("viewBox", WORDMARK.viewBox);
    expect(screen.getByRole("img", { name: "sheltüh lowercase" })).toHaveAttribute("viewBox", WORDMARK_LOWERCASE.viewBox);
    expect(screen.getByRole("img", { name: "Sheltüh ü" })).toHaveAttribute("viewBox", U_MARK.viewBox);
    expect(screen.getByRole("img", { name: "Two dots" })).toHaveAttribute("viewBox", DOTS_MARK.viewBox);
  });

  it("keep the mark's proportions: the size attributes are the viewBox's", () => {
    const { container } = render(<UMark />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "66.741");
    expect(svg).toHaveAttribute("height", "100.391");
  });
});

describe("DotsMark", () => {
  it("sizes by width (xs 12px … lg 64px) and moves the dots together when joined", () => {
    const { container } = render(
      <>
        <DotsMark size="xs" />
        <DotsMark size="lg" joined />
      </>,
    );
    const [apart, joined] = Array.from(container.querySelectorAll("svg"));
    expect(apart).toHaveClass("w-3", "h-auto");
    expect(apart.querySelector("path")).not.toHaveAttribute("transform");
    expect(joined).toHaveClass("w-16");
    expect(joined).toHaveAttribute("data-joined");
    expect(Array.from(joined.querySelectorAll("path")).map((p) => p.getAttribute("transform"))).toEqual([
      "translate(12.5 0)",
      "translate(-12.5 0)",
    ]);
  });

  it("DotsLoader shows its label, and is a status region only when asked to announce", () => {
    const { rerender } = render(<DotsLoader label="Confirming your order" />);
    expect(screen.getByText("Confirming your order…")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<DotsLoader label="Confirming your order" announce />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirming your order…");
  });
});

describe("Footer", () => {
  // Refinement (owner, 22 Oct 2026): the wordmark stays, at a restrained size (it was full width).
  it("is an ink section with the decorative orange wordmark at a restrained size; the © line carries the name", () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector("footer");
    expect(footer).toHaveAttribute("data-surface", "ink");
    const wordmark = footer?.querySelector(`svg[viewBox="${WORDMARK.viewBox}"]`);
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(wordmark).toHaveClass("text-signal", "h-7", "w-auto", "sm:h-8");
    expect(wordmark).not.toHaveClass("w-full");
    expect(screen.getByText(`© ${new Date().getFullYear()} Sheltüh`)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });

  it("keeps every support, explore, company and legal link, support first, with a way to reach a person (mobile-redesign.md §6.6)", () => {
    render(<Footer />);
    const groups = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"));
    expect(groups).toEqual(["Fan support", "Explore", "Our company", "Legal"]);
    const links = (name: string) =>
      within(screen.getByRole("navigation", { name }))
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links("Fan support")).toEqual([
      ["Help & FAQs", "/help"],
      ["Request a refund", "/refunds"],
      ["Contact support", `mailto:${SUPPORT_EMAIL}`],
    ]);
    expect(links("Explore")).toEqual([
      ["All events", "/events"],
      ["Map", "/map"],
      ["Search", "/search"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(links("Our company")).toEqual([
      ["About Sheltüh", "/about"],
      ["Become a partner", "/partners"],
    ]);
    expect(links("Legal")).toEqual([
      ["Privacy Policy", "/privacy"],
      ["Terms of Use", "/terms"],
      ["Purchase Terms", "/purchase-terms"],
    ]);
  });

  it("sets the legal links in readable sentence-case Instrument (not mono), 44px tall on phones", () => {
    render(<Footer />);
    for (const link of within(screen.getByRole("navigation", { name: "Legal" })).getAllByRole("link")) {
      expect(link).toHaveClass("text-sm", "leading-5", "min-h-11", "underline");
      expect(link.closest(".eyebrow")).toBeNull();
    }
  });

  it("keeps the campaign line (heard as one sentence), small, under the wordmark", () => {
    const { container } = render(<Footer />);
    const line = screen.getByText("Where is your Sheltüh?").closest("p");
    expect(line).toHaveClass("text-base", "font-semibold");
    expect(line).not.toHaveClass("display-lg");
    const wordmark = container.querySelector(`svg[viewBox="${WORDMARK.viewBox}"]`);
    if (!line || !wordmark) throw new Error("campaign line or wordmark missing");
    expect(wordmark.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps support and legal links visible without expanding anything", () => {
    render(<Footer />);
    const support = screen.getByRole("navigation", { name: "Fan support" });
    // Not a disclosure: no toggle, and its list is never hidden.
    expect(within(support).queryByRole("button")).toBeNull();
    expect(within(support).getByRole("list").className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
    const legal = screen.getByRole("navigation", { name: "Legal" });
    expect(within(legal).queryByRole("button")).toBeNull();
    expect(within(legal).getAllByRole("link")).toHaveLength(3);
  });

  it("groups Explore and Our company in disclosures on phones: a button with aria-expanded, closed at first, its list hidden until opened", () => {
    render(<Footer />);
    for (const name of ["Explore", "Our company"]) {
      const nav = screen.getByRole("navigation", { name });
      const toggle = within(nav).getByRole("button", { name });
      expect(toggle).toHaveAttribute("type", "button");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveClass("min-h-11", "sm:hidden");
      const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
      expect(list).toBe(within(nav).getByRole("list"));
      // Hidden on phones while closed; always shown from 640px, where the heading is a plain label.
      expect(list).toHaveClass("hidden", "sm:flex");
    }
  });

  it("opens and closes a group from the keyboard: the native button keeps focus and says its state", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Explore" });
    const toggle = within(nav).getByRole("button", { name: "Explore" });
    toggle.focus();
    expect(toggle).toHaveFocus();
    // Enter and Space on a native button fire click (jsdom doesn't synthesise that step).
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    const list = within(nav).getByRole("list");
    expect(list).toHaveClass("flex");
    expect(list).not.toHaveClass("hidden");
    expect(within(list).getByRole("link", { name: "All events" })).toHaveAttribute("href", "/events");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).toHaveClass("hidden");
    // The chevron is decorative.
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  describe("the install action", () => {
    afterEach(() => {
      resetInstallDismissedForTests();
      window.localStorage.clear();
      vi.restoreAllMocks();
      Reflect.deleteProperty(window, "matchMedia");
    });

    it("is one quiet line under the brand note, after it and before the link groups, with text buttons", () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.androidChrome);
      render(<Footer />);
      act(() => {
        window.dispatchEvent(
          Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
            prompt: vi.fn(async () => undefined),
            userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
          }),
        );
      });
      const offer = screen.getByRole("group", { name: "Get Sheltüh on your home screen" });
      const note = screen.getByText(/Sample events only|Curated creative events/);
      const firstGroup = screen.getByRole("navigation", { name: "Fan support" });
      expect(note.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(offer.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      for (const name of ["Install", "No thanks"]) {
        const button = within(offer).getByRole("button", { name });
        expect(button).toHaveClass("min-h-11", "text-sm", "underline");
        expect(button.className).not.toMatch(/\bbtn/);
      }
    });
  });
});
