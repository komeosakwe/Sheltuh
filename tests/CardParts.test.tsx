// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CategoryTag from "@/components/ui/CategoryTag";
import DateChip from "@/components/ui/DateChip";
import GoingRow from "@/components/ui/GoingRow";
import PriceTag from "@/components/ui/PriceTag";
import { cardDateChip, cardMetaParts } from "@/lib/event-card";
import { formatEventTimeCompact, formatEventWeekday } from "@/lib/format";
import { FREE_AND_PAID_LABEL, formatCardPriceLabel } from "@/lib/pricing";
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
  it("shows the weekday, day and month of the start as written, and is hidden from screen readers (the meta line says it)", () => {
    const { container } = render(<DateChip event={event} />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(Array.from(chip.children).map((el) => el.textContent)).toEqual(["Sat", "14", "Nov"]);
    expect(chip.querySelector(".uppercase")).toBeNull();
  });

  it("dates it in the event's own zone, not Melbourne's", () => {
    // 12:30 am on Sun 15 Nov in Melbourne is still Sat 14 Nov in Perth.
    const late = { startsAt: "2026-11-14T13:30:00.000Z", timeZone: "Australia/Perth" as const, state: "WA" as const };
    expect(cardDateChip(late)).toEqual({ weekday: "Sat", day: "14", month: "Nov" });
    expect(cardDateChip({ ...late, timeZone: undefined, state: "VIC" })).toEqual({ weekday: "Sun", day: "15", month: "Nov" });
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
    // The board's price label: 40px, Label/Button 16/24, 8px each side.
    expect(signal).toHaveClass("bg-signal", "text-signal-foreground", "rounded-control", "min-h-10", "label-button", "px-2");
    expect(neutral).toHaveClass("bg-surface", "text-foreground");
    expect(neutral).not.toHaveClass("bg-signal");
    for (const tag of [signal, neutral]) {
      expect(tag.tagName).toBe("SPAN");
      expect(tag).not.toHaveAttribute("tabindex");
    }
  });
});

describe("GoingRow", () => {
  it("demo: small overlapping colour dots (no initials, decorative) and the count on one line, with no '(sample)'", () => {
    const { container } = render(
      <GoingRow going={{ count: 12, sample: true }} faces={[{ name: "Mia T." }, { name: "Leo V." }, { name: "Aisha L." }]} />,
    );
    // The demo banner says it's sample data, so the card doesn't repeat it.
    expect(container.firstElementChild).toHaveTextContent(/^12 going$/);
    const count = container.firstElementChild?.lastElementChild as HTMLElement;
    expect(count).toHaveClass("truncate");
    const faces = container.querySelector("[data-card-faces]") as HTMLElement;
    expect(faces).toHaveAttribute("aria-hidden", "true");
    const dots = Array.from(faces.children);
    expect(dots).toHaveLength(3);
    for (const [i, dot] of dots.entries()) {
      expect(dot).toHaveClass("size-5", "rounded-full");
      expect(dot.textContent).toBe("");
      if (i > 0) expect(dot).toHaveClass("-ml-1.5");
    }
    // Colour dots in turn, never the same fill twice in a row.
    expect(dots[0].className).not.toBe(dots[1].className.replace(" -ml-1.5", ""));
  });

  it("shows a member's photo where there is one (decorative), else a dot", () => {
    const { container } = render(
      <GoingRow going={{ count: 5, sample: false }} faces={[{ name: "Mia T.", photoUrl: "/a.webp" }, { name: "Leo V." }]} />,
    );
    const [photo, dot] = Array.from(container.querySelectorAll("[data-card-face]"));
    expect(photo.querySelector("img")).toHaveAttribute("src", "/a.webp");
    expect(photo.querySelector("img")).toHaveAttribute("alt", "");
    expect(dot.querySelector("img")).toBeNull();
  });

  it("live: the count alone, no faces", () => {
    const { container } = render(<GoingRow going={{ count: 14, sample: false }} faces={[]} />);
    expect(container.firstElementChild).toHaveTextContent(/^14 going$/);
    expect(container.querySelector("[data-card-faces]")).toBeNull();
  });
});

describe("the card's price label text", () => {
  const ticket = { id: "t", name: "GA", priceCents: 0, feePolicy: "buyer-pays" as const, quantityAvailable: 10 };
  const base = { ticketingMode: "sheltuh" } as unknown as SheltuhEvent;
  it("says 'Free + paid' when a paid ticket is on sale beside a free one, and 'Free' only when every one on sale is free", () => {
    expect(formatCardPriceLabel({ ...base, ticketTypes: [ticket, { ...ticket, id: "p", priceCents: 3000 }] })).toBe(FREE_AND_PAID_LABEL);
    expect(FREE_AND_PAID_LABEL).toBe("Free + paid");
    expect(formatCardPriceLabel({ ...base, ticketTypes: [ticket] })).toBe("Free");
    // A sold-out paid tier isn't on sale: the free event is "Free".
    expect(formatCardPriceLabel({ ...base, ticketTypes: [ticket, { ...ticket, id: "p", priceCents: 3000, soldOut: true }] })).toBe("Free");
    expect(formatCardPriceLabel({ ...base, ticketTypes: [] })).toBeNull();
  });
});
