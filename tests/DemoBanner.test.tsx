// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DemoBanner from "@/components/DemoBanner";
import DemoNotice from "@/components/DemoNotice";

/*
 * The demo's disclosures (docs/design/mobile-redesign.md, Refinement 22 Oct
 * 2026): one slim sample-data banner per page, from the root layout, and
 * short "Demo" notes only where something won't happen (booking, waitlist,
 * adding yourself). e2e/demo.spec.ts checks there's exactly one banner on
 * the built pages.
 */

afterEach(cleanup);

describe("DemoBanner", () => {
  it("says, once and plainly, that the events, people and counts are samples and nothing is a real booking", () => {
    render(<DemoBanner />);
    const banner = screen.getByRole("note", { name: "Demo" });
    expect(banner).toHaveAttribute("data-demo-banner");
    expect(banner).toHaveTextContent("Demo · Sample data. No real bookings.");
    // Slim: one small line inside the page column.
    expect(banner.querySelector("p")).toHaveClass("text-xs", "py-2", "max-w-6xl");
  });

  it("is rendered once, by the root layout, and only in the demo (no API configured)", () => {
    const layout = readFileSync(path.resolve(import.meta.dirname, "..", "app/layout.tsx"), "utf8");
    expect(layout.match(/<DemoBanner \/>/g)).toHaveLength(1);
    expect(layout).toContain("{!isApiConfigured && <DemoBanner />}");
    // Inside main, so it's in a landmark and the skip link lands just above it.
    expect(layout.indexOf("<DemoBanner />")).toBeGreaterThan(layout.indexOf('<main id="main"'));
    expect(layout.indexOf("<DemoBanner />")).toBeLessThan(layout.indexOf("{children}"));
  });
});

describe("DemoNotice (at the booking points)", () => {
  it("is one quiet line: a small 'Demo' tag, then what won't happen here", () => {
    render(<DemoNotice>Checkout isn’t available in this demo.</DemoNotice>);
    const note = screen.getByRole("note");
    expect(note.tagName).toBe("P");
    expect(note).toHaveTextContent(/^DemoCheckout isn’t available in this demo\.$/);
    expect(note).toHaveClass("text-sm", "text-muted");
    expect(note.querySelector("span")).toHaveClass("text-xs", "font-semibold", "bg-surface");
    // No outlined badge any more.
    expect(note.innerHTML).not.toMatch(/border/);
  });
});
