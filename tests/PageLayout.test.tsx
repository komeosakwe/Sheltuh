// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BrandU from "@/components/brand/BrandU";
import { Page, PageHeader } from "@/components/ui/Section";

afterEach(cleanup);

describe("Page: the one centred container", () => {
  it.each([
    ["wide", null],
    ["narrow", "max-w-2xl"],
    ["form", "max-w-md"],
  ] as const)("%s sits centred between the site's gutters", (width, inner) => {
    const { container } = render(
      <Page width={width}>
        <p>Content</p>
      </Page>,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass("mx-auto", "w-full", "max-w-6xl", "px-5", "sm:px-8");
    if (inner) {
      const column = screen.getByText("Content").parentElement as HTMLElement;
      expect(column).toHaveClass("mx-auto", "w-full", inner);
    }
  });

  it("form stacks its children with a gap", () => {
    render(
      <Page width="form">
        <p>Content</p>
      </Page>,
    );
    expect(screen.getByText("Content").parentElement).toHaveClass("flex", "flex-col", "gap-8");
  });
});

// The redesign: a brand line is a display headline (display-l, Bootzy in capitals), and the
// brand's Ü goes through BrandU, so the shown line is hidden and the plain sentence is read.
describe("Brand headline: a display headline, read plainly", () => {
  it("sets a brand line in display-l, with the plain text as its name", () => {
    render(<PageHeader brand title="What’s on." />);
    const h1 = screen.getByRole("heading", { level: 1, name: "What’s on." });
    expect(h1).toHaveClass("display-l");
    expect(h1).not.toHaveClass("display-lg");
    expect(h1.textContent).toBe("What’s on.");
  });

  it("shows a line with the brand's Ü but reads the plain sentence", () => {
    render(<PageHeader brand title={<BrandU spoken="Sheltüh near you.">SHELTÜH NEAR YOÜ.</BrandU>} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Sheltüh near you.");
    expect(h1.querySelector('[aria-hidden="true"]')).toHaveTextContent("SHELTÜH NEAR YOÜ.");
  });

  it("keeps a page's ordinary h1 in display-lg (heading-h1's sizes, sentence case)", () => {
    render(<PageHeader title="Your tickets" />);
    expect(screen.getByRole("heading", { level: 1, name: "Your tickets" })).toHaveClass("display-lg");
  });
});
