// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DotsMark, { DotsLoader } from "@/components/brand/DotsMark";
import UMark from "@/components/brand/UMark";
import Wordmark from "@/components/brand/Wordmark";
import { DOTS_MARK, U_MARK, WORDMARK, WORDMARK_LOWERCASE, type BrandMark } from "@/components/brand/marks";
import Footer from "@/components/Footer";

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
  it("is an ink section closing on the decorative orange wordmark; the © line carries the name", () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector("footer");
    expect(footer).toHaveAttribute("data-surface", "ink");
    const wordmark = footer?.querySelector(`svg[viewBox="${WORDMARK.viewBox}"]`);
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(wordmark).toHaveClass("text-signal", "w-full", "h-auto");
    expect(screen.getByText(`© ${new Date().getFullYear()} Sheltüh`)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });
});
