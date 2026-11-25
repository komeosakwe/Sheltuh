// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import TicketCard, { type TicketCardState } from "@/components/tickets/TicketCard";

afterEach(cleanup);

const base = {
  when: "Sat 14 Nov · 5–9 pm",
  eventTitle: "Here & Now",
  venue: "Interconnect Studio",
  holder: "Alex Chen · Second release",
  count: "1 of 1",
};

/** The frames' eight states, with their words (Latte's sample copy). */
const FIXTURES: { state: TicketCardState; status?: string; action?: string; holder?: string }[] = [
  { state: "active" },
  { state: "transfer_pending", status: "Waiting for Sam to accept", action: "Cancel" },
  { state: "checked_in", status: "✓ Checked in at 7:42 pm" },
  { state: "changed", status: "New time: 6–10 pm. Your ticket still works.", action: "Details" },
  { state: "transferred", status: "This QR code no longer works", holder: "Sent to Sam Lee · accepted 13 Nov" },
  { state: "cancelled", status: "Event cancelled. A$25.94 refund on its way." },
  { state: "refunded", status: "Refunded A$25.94 on 15 Nov" },
  { state: "ended", status: "Event ended", action: "View receipt" },
];

const CURRENT: TicketCardState[] = ["active", "transfer_pending", "checked_in", "changed"];

function renderCard(fixture: (typeof FIXTURES)[number], onAction = vi.fn(), onShow = vi.fn()) {
  render(
    <TicketCard
      {...base}
      holder={fixture.holder ?? base.holder}
      state={fixture.state}
      status={fixture.status}
      statusAction={fixture.action ? { label: fixture.action, onClick: onAction } : undefined}
      showTicket={{ onClick: onShow }}
      image={<span data-art="" />}
    />,
  );
  return { card: screen.getByRole("article"), onAction, onShow };
}

describe("TicketCard", () => {
  it.each(FIXTURES)("$state: says its state in words, with the event, holder and count", (fixture) => {
    const { card } = renderCard(fixture);
    expect(card).toHaveAttribute("data-state", fixture.state);
    expect(within(card).getByRole("heading", { level: 3, name: "Here & Now" })).toBeInTheDocument();
    expect(within(card).getByText("Sat 14 Nov · 5–9 pm")).toBeInTheDocument();
    expect(within(card).getByText("Interconnect Studio")).toBeInTheDocument();
    expect(within(card).getByText(fixture.holder ?? base.holder)).toBeInTheDocument();
    expect(within(card).getByText("1 of 1")).toBeInTheDocument();
    const bar = card.querySelector("[data-ticket-status]");
    if (fixture.state === "active") expect(bar).toBeNull();
    else expect(bar).toHaveTextContent(fixture.status as string);
  });

  it.each(FIXTURES)("$state: current cards are white with a subtle border and Show ticket; past cards are muted with no button", (fixture) => {
    const { card } = renderCard(fixture);
    const current = CURRENT.includes(fixture.state);
    const thumb = card.querySelector("[data-art]")?.parentElement;
    if (current) {
      expect(card).toHaveClass("bg-card", "border", "border-surface-border");
      expect(thumb).not.toHaveClass("grayscale");
      expect(within(card).getByRole("button", { name: "Show ticket" })).toHaveClass("min-h-14", "bg-signal", "text-ink", "hover:bg-ink", "hover:text-signal");
      expect(within(card).getByText("Sat 14 Nov · 5–9 pm")).toHaveClass("text-foreground");
    } else {
      expect(card).toHaveClass("bg-surface");
      expect(card).not.toHaveClass("border");
      expect(thumb).toHaveClass("opacity-70", "grayscale");
      expect(within(card).queryByRole("button", { name: "Show ticket" })).toBeNull();
      expect(within(card).getByText("Sat 14 Nov · 5–9 pm")).toHaveClass("text-muted");
      expect(within(card).getByText("Interconnect Studio")).toHaveClass("text-muted");
    }
    // The title stays black on every card.
    expect(within(card).getByRole("heading")).toHaveClass("text-foreground", "line-clamp-2");
  });

  it("the status bar: muted on a current card, white on a past card, black with white text for Checked in", () => {
    const look = (state: TicketCardState) => {
      cleanup();
      const { card } = renderCard(FIXTURES.find((f) => f.state === state) as (typeof FIXTURES)[number]);
      return card.querySelector("[data-ticket-status]") as HTMLElement;
    };
    expect(look("transfer_pending")).toHaveClass("bg-surface", "text-foreground");
    expect(look("changed")).toHaveClass("bg-surface", "text-foreground");
    expect(look("checked_in")).toHaveClass("bg-ink", "text-paper");
    for (const state of ["transferred", "cancelled", "refunded", "ended"] as const) expect(look(state)).toHaveClass("bg-card", "text-foreground");
  });

  it("the bar's action is underlined and acts (Cancel, Details, View receipt)", () => {
    for (const fixture of FIXTURES.filter((f) => f.action)) {
      cleanup();
      const { card, onAction } = renderCard(fixture);
      const action = within(card).getByRole("button", { name: fixture.action });
      expect(action).toHaveClass("underline", "font-semibold");
      fireEvent.click(action);
      expect(onAction).toHaveBeenCalledTimes(1);
    }
  });

  it("Show ticket is a link when given an href and a button when given a handler; without it the card has no button", () => {
    const { rerender } = render(<TicketCard {...base} state="active" showTicket={{ href: "/tickets/abc" }} />);
    expect(screen.getByRole("link", { name: "Show ticket" })).toHaveAttribute("href", "/tickets/abc");
    const onShow = vi.fn();
    rerender(<TicketCard {...base} state="active" showTicket={{ onClick: onShow }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ticket" }));
    expect(onShow).toHaveBeenCalledTimes(1);
    rerender(<TicketCard {...base} state="active" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("nameActionsByEvent: a list's cards name their actions by the event for screen readers, the visible words unchanged", () => {
    const { rerender } = render(<TicketCard {...base} state="active" showTicket={{ href: "/a" }} nameActionsByEvent />);
    const link = screen.getByRole("link", { name: "Show ticket, Here & Now" });
    expect(link.querySelector(".sr-only")).toHaveTextContent(", Here & Now");
    rerender(<TicketCard {...base} state="ended" statusAction={{ href: "/b", label: "View order" }} nameActionsByEvent />);
    expect(screen.getByRole("link", { name: "View order, Here & Now" })).toHaveAttribute("href", "/b");
  });

  it("says each state's own words when given none, and takes the heading level of where it sits", () => {
    const { rerender } = render(<TicketCard {...base} state="ended" headingLevel={2} />);
    expect(screen.getByText("Event ended")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Here & Now" })).toBeInTheDocument();
    rerender(<TicketCard {...base} state="transferred" />);
    expect(screen.getByText("This QR code no longer works")).toBeInTheDocument();
    rerender(<TicketCard {...base} state="checked_in" />);
    expect(screen.getByText("✓ Checked in")).toBeInTheDocument();
  });

  it("one-line texts truncate so the count keeps its place; a card without a venue or count leaves them out", () => {
    render(<TicketCard state="active" when={base.when} eventTitle={base.eventTitle} holder="A very long holder name · A very long ticket type name" />);
    expect(screen.getByText(/A very long holder name/)).toHaveClass("truncate", "min-w-0", "flex-1");
    expect(screen.getByText(base.when)).toHaveClass("truncate");
    expect(screen.queryByText("Interconnect Studio")).toBeNull();
    expect(screen.queryByText("1 of 1")).toBeNull();
  });
});
