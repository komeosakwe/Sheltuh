// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegalNote from "@/components/auth/LegalNote";
import NotFoundMessage from "@/components/NotFoundMessage";
import { navigationTarget } from "@/components/RouteProgress";
import FilterChip, { filterChipClass } from "@/components/ui/FilterChip";
import { EmptyState, PageHeader, Panel } from "@/components/ui/Section";
import StatusBadge from "@/components/ui/StatusBadge";
import Strap from "@/components/ui/Strap";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Strap", () => {
  it("is a black rule with the orange dots and a mono label, and an optional muted note", () => {
    const { container } = render(<Strap label="This weekend" note="Fri 23 – Sun 25 Oct" />);
    const strap = container.firstElementChild;
    expect(strap).toHaveClass("eyebrow", "border-t", "border-foreground");
    expect(container.querySelector("svg.text-signal")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Fri 23 – Sun 25 Oct")).toHaveClass("text-muted");
  });

  it("drops the rule when the header's own rule is above it", () => {
    const { container } = render(<Strap label="Account" rule={false} />);
    expect(container.firstElementChild).not.toHaveClass("border-t");
  });
});

describe("PageHeader", () => {
  it("has a strap, the h1 and the intro, and never animates the h1", () => {
    render(<PageHeader eyebrow="Events · Melbourne" title="All of it" intro="Every night." />);
    const h1 = screen.getByRole("heading", { level: 1, name: "All of it" });
    expect(h1).toHaveClass("display-lg");
    expect(h1).not.toHaveClass("font-display", "rise");
    expect(screen.getByText("Events · Melbourne")).toBeInTheDocument();
    expect(screen.getByText("Every night.").closest(".rise")).not.toBeNull();
  });

  it("brand sets the h1 in the display face; md is the quieter tool header", () => {
    render(<PageHeader brand title="What’s on." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("display-lg", "font-display");
    cleanup();
    render(<PageHeader size="md" title="Admin" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("display-md");
  });

  it("flush drops its bottom margin", () => {
    const { container } = render(<PageHeader flush title="Sign in" />);
    expect(container.querySelector("header")).not.toHaveClass("mb-10");
  });
});

describe("Panel and EmptyState", () => {
  it("Panel: a black-ruled section titled in Instrument at 20px", () => {
    render(<Panel title="Good to know" titleId="gtk">x</Panel>);
    expect(screen.getByRole("region", { name: "Good to know" })).toHaveClass("border-t", "border-foreground");
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("font-heading", "text-xl");
  });

  it("EmptyState: the two dots above a big title, a short line and the action", () => {
    const { container } = render(
      <EmptyState title="No events match your filters" action={<button type="button">Reset</button>}>
        Try another.
      </EmptyState>,
    );
    const dots = container.querySelector("svg");
    expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(dots?.compareDocumentPosition(screen.getByText("No events match your filters"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("No events match your filters")).toHaveClass("display-md");
    cleanup();
    const { container: plain } = render(<EmptyState title="Refused" mark={false} />);
    expect(plain.querySelector("svg")).toBeNull();
  });
});

describe("FilterChip", () => {
  it("is a toggle button whose pressed state is announced and shown by more than colour", () => {
    const onClick = vi.fn();
    const { rerender, container } = render(
      <FilterChip pressed={false} onClick={onClick}>
        Tonight
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Tonight" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    // Owner (23 Oct 2026): unselected chips keep the card colour with a subtle boundary.
    expect(chip).toHaveClass("rounded-control", "border-foreground/50", "bg-card", "text-foreground");
    expect(chip).not.toHaveClass("bg-foreground");
    expect(container.querySelector("[data-selected-dots]")).toBeNull();
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <FilterChip pressed onClick={onClick}>
        Tonight
      </FilterChip>,
    );
    expect(chip).toHaveAttribute("aria-pressed", "true");
    // Selected: solid foreground with background-coloured text (white on black in Light, black on white in Dark).
    expect(chip).toHaveClass("border-foreground", "bg-foreground", "text-background");
    expect(chip).not.toHaveClass("border-foreground/50", "bg-card");
    // The two orange squares on the black chip (6.18:1), hidden from screen readers.
    const dots = container.querySelector("[data-selected-dots]");
    expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(dots?.querySelectorAll(".bg-signal")).toHaveLength(2);
  });

  it("is 44px tall on phones, 40px from 640px", () => {
    expect(filterChipClass(false)).toMatch(/\bh-11\b.*\bsm:h-10\b/);
  });
});

describe("StatusBadge", () => {
  it.each([
    ["pending", "border-foreground"],
    ["approved", "bg-foreground"],
    ["on-sale", "bg-signal"],
    ["rejected", "text-danger"],
  ] as const)("%s", (tone, cls) => {
    render(<StatusBadge tone={tone}>Label</StatusBadge>);
    expect(screen.getByText("Label")).toHaveClass("eyebrow", "rounded-badge", cls);
  });
});

describe("NotFoundMessage (404)", () => {
  it("asks 'Lost?' in the display face and points to what's on", () => {
    render(<NotFoundMessage />);
    expect(screen.getByRole("heading", { level: 1, name: "Lost?" })).toHaveClass("display-lg", "font-display");
    expect(screen.getByText(/That page isn.t here\. Try what.s on this week\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See what’s on" })).toHaveAttribute("href", "/events");
  });
});

describe("LegalNote", () => {
  it("links the Privacy Policy and Terms, underlined", () => {
    render(<LegalNote />);
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveClass("underline");
  });
});

describe("RouteProgress navigationTarget", () => {
  const here = new URL("https://sheltuh.com.au/events?category=art") as unknown as Location;
  const anchor = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement("a");
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    return a;
  };

  it("counts a link to another page on this site", () => {
    expect(navigationTarget(anchor("https://sheltuh.com.au/map"), here)).toBe("/map");
    expect(navigationTarget(anchor("https://sheltuh.com.au/events?category=music"), here)).toBe(
      "/events?category=music",
    );
  });

  it("ignores this page (and its fragments), other sites, new tabs, downloads and the API", () => {
    expect(navigationTarget(anchor("https://sheltuh.com.au/events?category=art#tickets"), here)).toBeNull();
    expect(navigationTarget(anchor("https://humanitix.com/x"), here)).toBeNull();
    expect(navigationTarget(anchor("https://sheltuh.com.au/map", { target: "_blank" }), here)).toBeNull();
    expect(navigationTarget(anchor("https://sheltuh.com.au/a.ics", { download: "" }), here)).toBeNull();
    expect(navigationTarget(anchor("https://sheltuh.com.au/api/orders/x"), here)).toBeNull();
  });
});
