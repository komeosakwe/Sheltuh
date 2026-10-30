// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DottedLine from "@/components/brand/DottedLine";
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

describe("Brand headline: a letter or two dotted, never the whole line", () => {
  it("keeps the plain text and accessible name, dotting only the marked letter", () => {
    render(
      <PageHeader brand title={<DottedLine line="What’s ^on." />} />,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "What’s on." });
    expect(h1).toHaveClass("display-plain", "font-display");
    expect(h1.textContent).toBe("What’s on.");
    const dotted = h1.querySelectorAll("[data-dotted-letter]");
    expect([...dotted].map((el) => el.textContent)).toEqual(["o"]);
  });
});
