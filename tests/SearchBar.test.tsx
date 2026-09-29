// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SearchBar from "@/components/SearchBar";

afterEach(cleanup);

describe("SearchBar", () => {
  it("is a named search landmark that submits a plain GET to /search?q=", () => {
    render(<SearchBar label="Search the site" />);
    const form = screen.getByRole("search", { name: "Search the site" });
    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    const input = screen.getByRole("searchbox", { name: "Search by event, venue or suburb" });
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
  });

  it("shows the current query", () => {
    render(<SearchBar defaultValue="neon" size="lg" />);
    expect(screen.getByRole("searchbox")).toHaveValue("neon");
  });

  it("gives two search bars on one page distinct landmark names", () => {
    render(
      <>
        <SearchBar label="Search the site" />
        <SearchBar label="Search events" size="lg" />
      </>,
    );
    expect(screen.getByRole("search", { name: "Search the site" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });
});
