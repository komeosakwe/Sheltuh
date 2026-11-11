// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CategoryTag from "@/components/ui/CategoryTag";
import DateChip from "@/components/ui/DateChip";
import GoingRow from "@/components/ui/GoingRow";
import PriceTag from "@/components/ui/PriceTag";
import { cardDateChip, cardMetaParts } from "@/lib/event-card";
import { formatEventTimeCompact, formatEventWeekday } from "@/lib/format";
import type { SheltuhEvent } from "@/lib/types";

/*
 * The event card's parts (the rules' Cards and Tags & chips boards): the date
 * chip in the event's own zone, the compact time, the tag, the price label
 * and the going row.
 */
afterEach(cleanup);

const event = {
  startsAt: "2026-11-14T06:00:00.000Z", // Sat 14 Nov, 5:00 pm in Melbourne (AEDT)
  timeZone: undefined,
  state: "VIC" as const,
};

describe("the compact card time", () => {
  it.each([
    ["2026-11-14T06:00:00.000Z", "5pm"],
    ["2026-11-14T08:30:00.000Z", "7:30pm"],
    ["2026-11-13T13:00:00.000Z", "12am"],
    ["2026-11-14T01:00:00.000Z", "12pm"],
    ["2026-11-14T00:05:00.000Z", "11:05am"],
  ])("%s is %s in Melbourne", (iso, time) => {
    expect(formatEventTimeCompact(iso)).toBe(time);
  });

  it("is in the zone given", () => {
    expect(formatEventTimeCompact("2026-11-14T06:00:00.000Z", "Australia/Perth")).toBe("2pm");
    expect(formatEventWeekday("2026-11-14T06:00:00.000Z", "Australia/Perth")).toBe("Sat");
  });
});

describe("DateChip", () => {
  it("shows the weekday, day and month of the start, and is hidden from screen readers (the mono line says it)", () => {
    const { container } = render(<DateChip event={event} />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(Array.from(chip.children).map((el) => el.textContent)).toEqual(["Sat", "14", "NOV"]);
  });

  it("dates it in the event's own zone, not Melbourne's", () => {
    // 12:30 am on Sun 15 Nov in Melbourne is still Sat 14 Nov in Perth.
    const late = { startsAt: "2026-11-14T13:30:00.000Z", timeZone: "Australia/Perth" as const, state: "WA" as const };
    expect(cardDateChip(late)).toEqual({ weekday: "Sat", day: "14", month: "NOV" });
    expect(cardDateChip({ ...late, timeZone: undefined, state: "VIC" })).toEqual({ weekday: "Sun", day: "15", month: "NOV" });
  });

  it("is white with black text in both themes (it sits on a photo), never orange text", () => {
    const { container } = render(<DateChip event={event} />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveClass("bg-paper", "text-ink", "rounded-badge");
    expect(chip.innerHTML).not.toMatch(/text-signal/);
  });
});

describe("the card's mono line", () => {
  const base = {
    id: "e",
    slug: "e",
    title: "E",
    description: "",
    category: "art",
    suburb: "Coburg",
    venueName: "The Hall",
    venueAddress: "",
    organiserId: "o",
    organiserName: "O",
    poster: { pattern: "waves", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [],
    ...event,
  } as SheltuhEvent;

  it("is the date, the compact time and 'Suburb, STATE' (owner decision D4)", () => {
    expect(cardMetaParts(base, new Date("2026-11-01T00:00:00.000Z"))).toEqual(["Sat 14 Nov", "5pm", "Coburg, VIC"]);
  });
});

describe("CategoryTag", () => {
  it("is plain text in its category's tint: no role, no tab stop, no outline, no hover", () => {
    render(<CategoryTag tone="live-music">Live music</CategoryTag>);
    const tag = screen.getByText("Live music").parentElement as HTMLElement;
    expect(tag.tagName).toBe("SPAN");
    expect(tag).toHaveAttribute("data-tag", "live-music");
    expect(tag).not.toHaveAttribute("role");
    expect(tag).not.toHaveAttribute("tabindex");
    expect(tag).toHaveClass("label-tag", "h-6", "rounded-badge", "px-2");
    expect(tag.className).not.toMatch(/\bborder\b|hover:|outline/);
  });
});

describe("PriceTag", () => {
  it("is an orange label with black text, or a quiet neutral one; never a control", () => {
    const { container } = render(
      <>
        <PriceTag>From A$37.60</PriceTag>
        <PriceTag tone="neutral">Tickets coming soon</PriceTag>
      </>,
    );
    const [signal, neutral] = Array.from(container.querySelectorAll("[data-price-tag]"));
    expect(signal).toHaveClass("bg-signal", "text-signal-foreground", "rounded-control", "min-h-8");
    expect(neutral).toHaveClass("bg-surface", "text-foreground");
    expect(neutral).not.toHaveClass("bg-signal");
    for (const tag of [signal, neutral]) {
      expect(tag.tagName).toBe("SPAN");
      expect(tag).not.toHaveAttribute("tabindex");
    }
  });
});

describe("GoingRow", () => {
  it("demo: round faces (decorative) and the count labelled a sample", () => {
    const { container } = render(<GoingRow going={{ count: 12, sample: true }} faces={["Mia T.", "Leo V.", "Aisha L."]} />);
    // The faces are decorative initials; the words read are the count.
    expect(container.firstElementChild?.lastElementChild).toHaveTextContent(/^12 going \(sample\)$/);
    const faces = container.querySelector("[data-card-faces]") as HTMLElement;
    expect(faces).toHaveAttribute("aria-hidden", "true");
    expect(faces.children).toHaveLength(3);
  });

  it("live: the count alone, no faces", () => {
    const { container } = render(<GoingRow going={{ count: 14, sample: false }} faces={[]} />);
    expect(container.firstElementChild).toHaveTextContent(/^14 going$/);
    expect(container.querySelector("[data-card-faces]")).toBeNull();
  });
});
