// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import FullTicket, { type FullTicketProps } from "@/components/tickets/FullTicket";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HINT = "Turn your brightness up. If the QR code won’t scan, door staff can type in the backup code.";

const base: FullTicketProps = {
  eventTitle: "Here & Now",
  venueLine: "Interconnect Studio · Coburg North",
  date: "Sat 14 Nov",
  time: "5–9 pm",
  typeName: "Second release",
  code: "BPT7-7P6W",
  ticketNumber: 1,
  ticketCount: 1,
};

const ticket = () => screen.getByRole("article");

describe("FullTicket (the site's version of the email ticket)", () => {
  it("is the orange-outline ticket: a Signal Orange frame, a white inside, the stripes and ADMIT ONE · SHELTÜH, pinned to the Light theme", () => {
    render(<FullTicket {...base} image={<span data-art="" />} />);
    const card = ticket();
    expect(card).toHaveClass("bg-signal", "p-3", "rounded-card", "print:break-inside-avoid");
    const inside = card.firstElementChild as HTMLElement;
    expect(inside).toHaveClass("bg-paper", "text-ink", "overflow-hidden");
    expect(inside).toHaveAttribute("data-surface", "paper");
    expect(within(card).getByText("ADMIT ONE · SHELTÜH")).toHaveClass("font-mono");
    // The stripes: decoration, four bars in the frame's orange.
    const stripes = card.querySelector("svg.fill-signal");
    expect(stripes).toHaveAttribute("aria-hidden", "true");
    expect(stripes?.querySelectorAll("polygon")).toHaveLength(4);
    // The perforation: a dashed line with a notch of the frame's orange each side, all decoration.
    const perforation = card.querySelector(".border-dashed")?.parentElement as HTMLElement;
    expect(perforation).toHaveAttribute("aria-hidden", "true");
    expect(perforation.querySelectorAll(".rounded-full.bg-signal")).toHaveLength(2);
  });

  it("shows the event, DATE / TIME / TICKET, a named QR, the backup code under it and where it sits in the order", () => {
    render(<FullTicket {...base} image={<span data-art="" />} />);
    const card = ticket();
    expect(within(card).getByRole("heading", { level: 2, name: "Here & Now" })).toBeInTheDocument();
    expect(within(card).getByText("Interconnect Studio · Coburg North")).toHaveClass("uppercase", "text-signal-text");
    const terms = Array.from(card.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(terms).toEqual([
      ["Date", "Sat 14 Nov"],
      ["Time", "5–9 pm"],
      ["Ticket", "Second release"],
    ]);
    const qr = within(card).getByRole("img", { name: "QR code for ticket BPT7-7P6W" });
    const code = within(card).getByText("BPT7-7P6W");
    expect(qr.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(code).toHaveClass("font-mono", "select-all");
    // The code is named for assistive tech, as the email's is by its place under the QR.
    expect(within(card).getByText("Backup code")).toHaveClass("sr-only");
    expect(within(card).getByText("Show this at the door · ticket 1 of 1")).toBeInTheDocument();
    expect(card.querySelector("[data-art]")?.parentElement).toHaveClass("overflow-hidden", "rounded");
  });

  it("on the page: compact on phones (image 96, a 168 QR area with the 165 plate, no venue line, no hint), larger from 768", () => {
    render(<FullTicket {...base} image={<span data-art="" />} />);
    const card = ticket();
    expect(card).toHaveAttribute("data-ticket-size", "page");
    expect(card.querySelector("[data-art]")?.parentElement).toHaveClass("h-24", "md:h-32");
    expect(within(card).getByText("Interconnect Studio · Coburg North")).toHaveClass("max-md:hidden");
    const plate = within(card).getByRole("img").parentElement as HTMLElement;
    expect(plate).toHaveClass("size-[165px]", "md:size-[198px]");
    // The box is the plate's width, and keeps the 168 area's height with the plate's top on a whole pixel (1 + 165 + 2).
    expect(plate.parentElement).toHaveClass("max-md:pt-px", "max-md:pb-0.5");
    expect(plate.parentElement?.className).not.toMatch(/size-/);
    expect(within(card).getByText(HINT)).toHaveClass("max-md:hidden", "print:hidden");
  });

  it("full screen: large for scanning (231 / 264), image 84, the venue line at every width, no hint", () => {
    render(<FullTicket {...base} size="screen" image={<span data-art="" />} />);
    const card = ticket();
    expect(card).toHaveAttribute("data-ticket-size", "screen");
    expect(card.querySelector("[data-art]")?.parentElement).toHaveClass("h-21");
    expect(within(card).getByText("Interconnect Studio · Coburg North")).not.toHaveClass("max-md:hidden");
    expect(within(card).getByRole("img").parentElement).toHaveClass("size-[231px]", "min-[375px]:size-[264px]");
    expect(within(card).queryByText(HINT)).toBeNull();
  });

  it("falls back to the text code alone, as the Entry code, for a code that isn't a real one", () => {
    render(<FullTicket {...base} code="ABC123" />);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Entry code")).toBeInTheDocument();
    expect(screen.queryByText("Backup code")).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("numbers the ticket in its order, names a group ticket's person, and shows the holder and seat when there are any", () => {
    render(
      <FullTicket
        {...base}
        typeName="Group of 4"
        group={{ position: 2, size: 4 }}
        ticketNumber={6}
        ticketCount={8}
        holderName="Alex Chen"
        seat={{ section: "Stalls", row: "F", seat: "12", kind: "standard" }}
      />,
    );
    const card = ticket();
    expect(within(card).getByText("Show this at the door · ticket 6 of 8")).toBeInTheDocument();
    const terms = Object.fromEntries(Array.from(card.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(terms.Ticket).toBe("Group of 4 (2 of 4)");
    expect(terms.Holder).toBe("Alex Chen");
    expect(terms.Seat).toContain("Stalls");
    expect(terms.Seat).toContain("Row F");
    expect(terms.Seat).toContain("Seat 12");
  });

  it("a seat line is shown short and said in full to screen readers (docs/design/seating.md §5.15)", () => {
    render(<FullTicket {...base} seat={{ section: "Stalls", row: "F", seat: "12", kind: "standard" }} />);
    const card = ticket();
    const line = within(card).getByText("Stalls · Row F · Seat 12");
    expect(line).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByText("Stalls, Row F, Seat 12")).toHaveClass("sr-only");
    expect(line.closest("dd")?.previousElementSibling).toHaveTextContent("Seat");
  });

  it("a ticket with no holder, seat, image or venue leaves them out", () => {
    render(<FullTicket eventTitle="Here & Now" typeName="GA" code="BPT7-7P6W" ticketNumber={1} ticketCount={1} />);
    const card = ticket();
    expect(Array.from(card.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual(["Ticket"]);
    expect(card.querySelector(".h-24")).toBeNull();
  });

  it("an unlisted event: says so with the support address, and shows no image, venue, date or time; the QR and code stay", () => {
    render(<FullTicket {...base} eventUnlisted image={<span data-art="" />} />);
    const card = ticket();
    expect(card).toHaveTextContent("This event is no longer listed. Contact support@sheltuh.com.au if you have questions.");
    expect(within(card).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(card.querySelector("[data-art]")).toBeNull();
    expect(within(card).queryByText("Interconnect Studio · Coburg North")).toBeNull();
    expect(Array.from(card.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual(["Ticket"]);
    expect(within(card).getByRole("img", { name: "QR code for ticket BPT7-7P6W" })).toBeInTheDocument();
    expect(within(card).getByText("BPT7-7P6W")).toBeInTheDocument();
  });

  it("checked in: an orange stamp says so in words with the door's time (black text), the QR dims behind it, the code stays readable, and the hint goes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-06T11:00:00.000Z")); // 10:00 pm Sat, Melbourne
    render(<FullTicket {...base} checkedInAt="2027-03-06T09:42:00.000Z" />);
    const card = ticket();
    const stamp = card.querySelector("[data-ticket-stamp]") as HTMLElement;
    expect(stamp).toHaveClass("bg-signal", "text-ink", "absolute");
    expect(stamp).toHaveTextContent("Checked in");
    expect(stamp).toHaveTextContent("8:42 pm · Enjoy the night");
    expect(within(card).getByRole("img").parentElement?.parentElement).toHaveClass("opacity-15");
    // The code keeps its contrast (dimmed, it would fail WCAG AA).
    expect(within(card).getByText("BPT7-7P6W").className).not.toMatch(/opacity/);
    expect(within(card).queryByText(HINT)).toBeNull();
  });

  it("checked in on another day says the day; in the event's own zone when it has one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-08T01:00:00.000Z"));
    const { rerender } = render(<FullTicket {...base} checkedInAt="2027-03-06T09:42:00.000Z" />);
    expect(ticket()).toHaveTextContent("Sat 6 Mar, 8:42 pm · Enjoy the night");
    vi.setSystemTime(new Date("2027-03-06T15:50:00.000Z"));
    rerender(<FullTicket {...base} checkedInAt="2027-03-06T15:30:00.000Z" timeZone="Australia/Perth" />);
    expect(ticket()).toHaveTextContent("11:30 pm · Enjoy the night");
  });

  it("a ticket that isn't checked in has no stamp and nothing dimmed", () => {
    render(<FullTicket {...base} checkedInAt={null} />);
    const card = ticket();
    expect(card.querySelector("[data-ticket-stamp]")).toBeNull();
    expect(card.querySelector(".opacity-15")).toBeNull();
  });

  it("a checked-in ticket without a QR keeps its code readable, with the stamp under it", () => {
    render(<FullTicket {...base} code="ABC123" checkedInAt="2027-03-06T09:42:00.000Z" />);
    expect(screen.getByText("ABC123").className).not.toMatch(/opacity/);
    expect(ticket().querySelector("[data-ticket-stamp]")).not.toHaveClass("absolute");
  });
});

describe("FullTicket: a ticket on offer (locked) and one someone was sent", () => {
  // The event's side of `base`, with no code or numbering.
  const event = { eventTitle: base.eventTitle, venueLine: base.venueLine, date: base.date, time: base.time, typeName: base.typeName };

  it("locked: the same ticket with a faint placeholder for the QR and the words, and no code of any kind anywhere", () => {
    const { container } = render(<FullTicket {...event} locked holderName="Sam Lee" />);
    const card = ticket();
    expect(card).toHaveClass("bg-signal");
    expect(within(card).getByText("Accept the ticket to get your QR code")).toBeInTheDocument();
    expect(within(card).getByText("Sam Lee")).toBeInTheDocument();
    // The placeholder is decoration: hidden from screen readers, faint, and no QR image.
    const placeholder = card.querySelector("[data-qr-locked]");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder?.parentElement).toHaveClass("opacity-15");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.querySelector('[data-qr="modules"]')).toBeNull();
    // No backup code, "Show this at the door", check-in stamp or brightness hint.
    expect(container.innerHTML).not.toMatch(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    expect(within(card).queryByText(/Show this at the door/)).toBeNull();
    expect(within(card).queryByText("Backup code")).toBeNull();
    expect(within(card).queryByText(HINT)).toBeNull();
  });

  it("locked ignores a check-in time: no stamp (nothing is the viewer's yet)", () => {
    render(<FullTicket {...event} locked checkedInAt="2026-11-14T08:42:00.000Z" />);
    expect(ticket().querySelector("[data-ticket-stamp]")).toBeNull();
  });

  it("without a number (a ticket someone was sent): Show this at the door, with no 'ticket n of N'", () => {
    render(<FullTicket {...event} code="K9QD-4XRT" holderName="Sam Lee" />);
    expect(within(ticket()).getByText("Show this at the door")).toBeInTheDocument();
    expect(within(ticket()).queryByText(/ticket \d+ of \d+/)).toBeNull();
    expect(within(ticket()).getByRole("img", { name: /K9QD-4XRT/ })).toBeInTheDocument();
  });
});
