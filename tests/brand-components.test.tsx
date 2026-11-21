// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
  // Latte's 1120 footer frames: the orange wordmark 151 × 34 at every width (owner, 22 Oct 2026: never full width).
  it("is an ink section with the decorative orange wordmark, 34px tall at every width; the © line carries the name", () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector("footer");
    expect(footer).toHaveAttribute("data-surface", "ink");
    const wordmark = footer?.querySelector(`svg[viewBox="${WORDMARK.viewBox}"]`);
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(wordmark).toHaveClass("text-signal", "h-8.5", "w-auto");
    expect(wordmark?.getAttribute("class")).not.toMatch(/(?:^|\s)(?:sm|md|lg|xl):h-/);
    expect(wordmark).not.toHaveClass("w-full");
    expect(screen.getByText(`© ${new Date().getFullYear()} Sheltüh`)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });

  it("keeps the proposal's columns, Fan support first, then Explore, Our company and Contact Sheltüh, and the legal links", () => {
    render(<Footer />);
    const groups = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"));
    expect(groups).toEqual(["Fan support", "Explore", "Our company", "Contact Sheltüh", "Legal"]);
    const links = (name: string) =>
      within(screen.getByRole("navigation", { name }))
        .getAllByRole("link")
        .map((a) => [a.getAttribute("aria-label") ?? a.textContent, a.getAttribute("href")]);
    expect(links("Fan support")).toEqual([
      ["Help & FAQs", "/help"],
      ["Request a refund", "/refunds"],
      ["Contact support", `mailto:${SUPPORT_EMAIL}`],
    ]);
    expect(links("Explore")).toEqual([
      ["All events", "/events"],
      ["Nearby", "/map"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(links("Our company")).toEqual([
      ["About Sheltüh", "/about"],
      ["Become a partner", "/partners"],
    ]);
    // Latte's 1120 set and order: LinkedIn, Instagram (Sheltüh's own, owner 13 Nov 2026), then email, each named for
    // screen readers, the socials opening a new tab. No TikTok: Latte's frames don't have it.
    expect(links("Contact Sheltüh")).toEqual([
      ["Sheltüh on LinkedIn (opens in a new tab)", "https://www.linkedin.com/company/sheltuh/"],
      ["Sheltüh on Instagram (opens in a new tab)", "https://www.instagram.com/findsheltuh/"],
      [`Email ${SUPPORT_EMAIL}`, `mailto:${SUPPORT_EMAIL}`],
    ]);
    expect(screen.queryByRole("link", { name: /TikTok/ })).toBeNull();
    for (const social of within(screen.getByRole("navigation", { name: "Contact Sheltüh" })).getAllByRole("link").slice(0, 2)) {
      expect(social).toHaveAttribute("target", "_blank");
      expect(social).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(links("Legal")).toEqual([
      ["Privacy Policy", "/privacy"],
      ["Terms of Use", "/terms"],
      ["Purchase Terms", "/purchase-terms"],
    ]);
  });

  it("keeps the legal links (not in Latte's frames) quietly in the footer's Mono/S grey, underlined, at least 24px tall", () => {
    render(<Footer />);
    for (const link of within(screen.getByRole("navigation", { name: "Legal" })).getAllByRole("link")) {
      expect(link).toHaveClass("font-mono", "text-xs", "leading-4", "text-footer-label", "min-h-6", "underline");
      expect(link).not.toHaveClass("uppercase");
    }
    expect(screen.getByText(`© ${new Date().getFullYear()} Sheltüh`)).toHaveClass("font-mono", "text-footer-label");
  });

  it("keeps the campaign line (heard as one sentence), Label/Nav (Medium 18/24), under the wordmark", () => {
    const { container } = render(<Footer />);
    const line = screen.getByText("Where is your Sheltüh?").closest("p");
    expect(line).toHaveClass("label-nav");
    expect(line).not.toHaveClass("font-semibold");
    expect(line).not.toHaveClass("display-lg");
    const wordmark = container.querySelector(`svg[viewBox="${WORDMARK.viewBox}"]`);
    if (!line || !wordmark) throw new Error("campaign line or wordmark missing");
    expect(wordmark.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds the Theme switch under the campaign line, before the columns", () => {
    render(<Footer />);
    const theme = screen.getByRole("group", { name: "Theme" });
    const line = screen.getByText("Where is your Sheltüh?");
    expect(line.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const support = screen.getByRole("navigation", { name: "Fan support" });
    expect(theme.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows every link without expanding anything: no disclosures, Mono/S labels, Body/S rows 28 apart with 24px targets, three groups in a row with Contact below, then one row", () => {
    const { container } = render(<Footer />);
    // The only buttons are the theme switch's two.
    expect(within(container).queryAllByRole("button").filter((b) => !b.closest("[data-theme-switch]"))).toEqual([]);
    for (const name of ["Fan support", "Explore", "Our company"]) {
      const nav = screen.getByRole("navigation", { name });
      expect(within(nav).getByRole("list").className).not.toMatch(/(?:^|\s)hidden(?:\s|$)/);
      // Latte's column label: IBM Plex Mono Regular 12/16 in #999, as written.
      expect(within(nav).getByText(name)).toHaveClass("font-mono", "text-xs", "leading-4", "font-normal", "text-footer-label");
      expect(within(nav).getByText(name)).not.toHaveClass("eyebrow");
      // 8 between rows (Latte's 28px rhythm), at every width.
      expect(within(nav).getByRole("list")).toHaveClass("flex", "flex-col", "gap-2");
      // Body/S (14/20) at every width (Figma 1120), block-level on its 20px line; 2px of padding each way (cancelled
      // by the margin, so the rhythm holds) makes a 24px-tall target (WCAG 2.5.8).
      for (const link of within(nav).getAllByRole("link")) {
        expect(link).toHaveClass("body-s", "block", "py-0.5", "-my-0.5");
        expect(link).not.toHaveClass("body-m", "min-h-11");
      }
    }
    // LinkedIn, Instagram and email: 40px tiles 8 apart in Latte's light grey, each a 24px icon, decorative (the label names it).
    const contact = screen.getByRole("navigation", { name: "Contact Sheltüh" });
    expect(within(contact).getByText("Contact Sheltüh")).toHaveClass("font-mono", "text-footer-label");
    expect(within(contact).getByRole("list")).toHaveClass("gap-2");
    for (const icon of within(contact).getAllByRole("link")) {
      expect(icon).toHaveClass("size-10", "text-footer-icon");
      expect(icon.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(icon.querySelector("svg")).toHaveClass("size-6");
    }
    // Figma 1120 (mobile footer): Fan support, Explore and Our company side by side in one row, spread across the
    // width; Contact Sheltüh on its own row below, 24 between them. From lg (Latte's 1440) the row dissolves
    // (display: contents) into the footer's row: the brand block takes the free width, each column as wide as its
    // words, 64 apart.
    const row = screen.getByRole("navigation", { name: "Fan support" }).parentElement;
    expect(row).toHaveClass("flex", "justify-between", "lg:contents");
    expect([...(row?.children ?? [])].map((nav) => nav.getAttribute("aria-label"))).toEqual(["Fan support", "Explore", "Our company"]);
    const main = row?.parentElement;
    expect(main).toHaveClass("flex", "flex-col", "gap-6", "lg:flex-row", "lg:gap-16");
    expect(main?.firstElementChild).toHaveClass("lg:flex-1");
    expect(main?.lastElementChild).toBe(contact);
    for (const nav of [...(row?.children ?? []), contact]) expect(nav).toHaveClass("lg:shrink-0");
  });

  describe("the install action", () => {
    afterEach(() => {
      resetInstallDismissedForTests();
      window.localStorage.clear();
      vi.restoreAllMocks();
      Reflect.deleteProperty(window, "matchMedia");
    });

    it("is one quiet line under the campaign line, after it and before the link groups, with text buttons", () => {
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
      const note = document.querySelector('[data-campaign-line]') as HTMLElement;
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
