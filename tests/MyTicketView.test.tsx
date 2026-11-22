// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DemoTicket from "@/components/tickets/DemoTicket";
import MyTicketView from "@/components/tickets/MyTicketView";
import type { CustomerOrder } from "@/lib/api/types";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
import { sampleTicketOrder } from "@/lib/sample-order";
import type { SheltuhEvent } from "@/lib/types";

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const release = vi.fn(async () => {});
const requestScreenWakeLock = vi.fn(async () => ({ release }));
vi.mock("@/lib/check-in/wake-lock", () => ({ requestScreenWakeLock: () => requestScreenWakeLock() }));

afterEach(() => {
  cleanup();
  release.mockClear();
  requestScreenWakeLock.mockClear();
});

/** Latte's sample order: Here & Now, Sat 14 Nov 2026, 5–9 pm AEDT. */
const ORDER: CustomerOrder = {
  status: "paid",
  reference: "#A90133C9",
  eventTitle: "Here & Now",
  eventSlug: "here-now",
  eventListed: true,
  eventStartsAt: "2026-11-14T06:00:00.000Z",
  eventEndsAt: "2026-11-14T10:00:00.000Z",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  eventState: "VIC",
  refundPolicy: "no_change_of_mind",
  subtotalCents: 2300,
  buyerFeeCents: 188,
  totalCents: 2488,
  wallet: { apple: true, google: true },
  tickets: [{ ticketCode: "BPT7-7P6W", ticketTypeName: "Second release", checkedInAt: null }],
};
const TWO: CustomerOrder = { ...ORDER, tickets: [...ORDER.tickets, { ticketCode: "K4M2-9QXA", ticketTypeName: "Second release", checkedInAt: null }] };

const sample = sampleTicketOrder();
if (!sample) throw new Error("the samples have no ticketed event");
/** The event as its public page has it: a street address and an image. */
const EVENT: SheltuhEvent = {
  ...sample.event,
  slug: "here-now",
  title: "Here & Now",
  venueName: "Interconnect Studio",
  venueAddress: "16 Catherine St",
  suburb: "Coburg North",
  state: "VIC",
  venuePlaceId: undefined,
  venuePinned: undefined,
};

/** The page's own pager (not the full-screen one): Previous / Next beside "Ticket 1 of 2". */
const pageTickets = () => screen.getByRole("region", { name: "Your tickets" });
const pagePager = (name: "Previous ticket" | "Next ticket") => within(pageTickets()).getByRole("button", { name });
const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;

describe("MyTicketView (Latte's My ticket page around the orange-outline ticket)", () => {
  it("the title group: the order line with its status in words, the event as the h1, the date line and the venue", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    expect(screen.getByText("Order #A90133C9 Confirmed")).toHaveClass("font-mono", "text-signal-text");
    expect(screen.getByRole("heading", { level: 1, name: "Here & Now" })).toBeInTheDocument();
    expect(screen.getByText("Sat 14 Nov · 5:00 – 9:00 pm AEDT")).toHaveClass("font-mono", "text-muted");
    expect(screen.getAllByText("Interconnect Studio · Coburg North")).toHaveLength(2); // the title group and the ticket
  });

  it("the h1 is the page's first heading: the tickets before it are a named region, their titles not headings", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" event={EVENT} />);
    const headings = screen.getAllByRole("heading");
    expect(headings[0]).toBe(screen.getByRole("heading", { level: 1, name: "Here & Now" }));
    expect(headings.slice(1).map((h) => h.tagName)).toEqual(headings.slice(1).map(() => "H2"));
    const tickets = screen.getByRole("region", { name: "Your tickets" });
    expect(within(tickets).queryAllByRole("heading")).toHaveLength(0);
    // Each ticket still shows the event's name as its title.
    // (Kept as heading elements with role="none", so they keep the headings' type.)
    expect(within(tickets).getAllByText("Here & Now", { selector: 'h2[role="none"]' })).toHaveLength(2);
  });

  it("the ticket column is 296 wide from 768 and 360 from 1024, beside the details; stacked on phones", () => {
    const { container } = render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    expect(container.firstElementChild).toHaveClass("flex-col", "gap-6", "md:flex-row", "lg:gap-12");
    expect(screen.getByRole("region", { name: "Your tickets" })).toHaveClass("md:w-74", "lg:w-90", "md:shrink-0");
    expect(screen.getByRole("article")).toHaveAttribute("data-ticket-size", "page");
  });

  it("Add to calendar: three equal buttons (Google, Apple, Outlook), each straight to its calendar", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" event={EVENT} />);
    const links = within(card("Add to calendar")).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Google Calendar (opens in a new tab)", "Apple Calendar", "Outlook (opens in a new tab)"]);
    for (const a of links) expect(a).toHaveClass("btn-outline", "btn-sm", "flex-1");
    expect(links[0].getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\//);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("href", "/events/here-now/calendar.ics");
    expect(links[2].getAttribute("href")).toMatch(/outlook/);
  });

  it("on the narrowest phones the three buttons give way to one, which opens the list (Google, Apple with its note, Outlook)", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" event={EVENT} />);
    const open = within(card("Add to calendar")).getByRole("button", { name: "Choose a calendar" });
    expect(open).toHaveClass("min-[360px]:hidden");
    expect(open.previousElementSibling).toHaveClass("max-[359px]:hidden");
    fireEvent.click(open);
    const sheet = screen.getByRole("dialog", { name: "Add to calendar" });
    expect(within(sheet).getByText("Here & Now · Sat 14 Nov, 5–9 pm")).toBeInTheDocument();
    const rows = within(sheet).getAllByRole("link");
    expect(rows.map((a) => a.textContent)).toEqual(["Google Calendar (opens in a new tab)›", "Apple Calendar Downloads an .ics file›", "Outlook (opens in a new tab)›"]);
    expect(rows[1]).toHaveAttribute("href", "/events/here-now/calendar.ics");
    expect(rows[1]).toHaveAttribute("download");
    expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("Getting there: the venue, its address with the place, and Google and Apple Maps links", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" event={EVENT} />);
    const there = card("Getting there");
    expect(within(there).getByText("Interconnect Studio")).toHaveClass("font-semibold");
    expect(within(there).getByText("16 Catherine St, Coburg North VIC")).toHaveClass("text-muted");
    const google = within(there).getByRole("link", { name: "Google Maps (opens in a new tab)" });
    expect(google.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=Interconnect%20Studio%2C%2016%20Catherine%20St/);
    expect(within(there).getByRole("link", { name: "Apple Maps (opens in a new tab)" }).getAttribute("href")).toMatch(/^https:\/\/maps\.apple\.com\/\?daddr=16%20Catherine%20St/);
  });

  it("without the event's public details the venue is the order's own: its name and place", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    const there = card("Getting there");
    expect(there).toHaveTextContent("Interconnect StudioCoburg North, VIC");
    expect(within(there).getByRole("link", { name: /Google Maps/ })).toBeInTheDocument();
  });

  it("the map placeholder opens Directions: Apple Maps, Google Maps and Copy address, which says it copied", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MyTicketView order={ORDER} sessionId="ord_1" event={EVENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Directions to Interconnect Studio" }));
    const sheet = screen.getByRole("dialog", { name: "Interconnect Studio" });
    expect(within(sheet).getByText("16 Catherine St, Coburg North VIC")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("link").map((a) => a.textContent)).toEqual(["Apple Maps (opens in a new tab)↗", "Google Maps (opens in a new tab)↗"]);
    const status = within(sheet).getByRole("status");
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(within(sheet).getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(status).toHaveTextContent("Address copied"));
    expect(writeText).toHaveBeenCalledWith("16 Catherine St, Coburg North VIC");
  });

  it("Copy address says so when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    render(<MyTicketView order={ORDER} sessionId="ord_1" event={EVENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Directions to Interconnect Studio" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn’t copy. Select the address above instead."));
  });

  it("a venue with no name: its street is the title and the place under it, and Copy address copies both", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MyTicketView order={{ ...ORDER, venueName: undefined }} sessionId="ord_1" event={{ ...EVENT, venueName: "" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Directions to 16 Catherine St" }));
    const sheet = screen.getByRole("dialog", { name: "16 Catherine St" });
    expect(within(sheet).getByText("Coburg North, VIC")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(within(sheet).getByRole("status")).toHaveTextContent("Address copied"));
    expect(writeText).toHaveBeenCalledWith("16 Catherine St, Coburg North, VIC");
  });

  it("Ticket details: label left, value right; rows with no data yet (PURCHASED) are left out", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    const details = card("Ticket details");
    const rows = Array.from(details.querySelectorAll("dt")).map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(rows).toEqual([
      ["Ticket", "Second release · 1 of 1"],
      ["Order", "#A90133C9"],
      ["Total paid", "A$24.88 incl. fees"],
    ]);
    for (const dt of details.querySelectorAll("dt")) {
      expect(dt).toHaveClass("font-mono", "uppercase", "text-muted");
      expect(dt.parentElement).toHaveClass("justify-between");
    }
    expect(details).not.toHaveTextContent(/purchased/i);
  });

  it("Manage order holds only what works today: Request a refund, with the refund terms; Send joins when the page can send", () => {
    const onSend = vi.fn();
    const { rerender } = render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Manage order" }));
    let sheet = screen.getByRole("dialog", { name: "Manage order" });
    expect(within(sheet).getByText("Order #A90133C9 · 1 ticket")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(1);
    expect(within(sheet).getByRole("link", { name: /Request a refund/ })).toHaveAttribute("href", "/refunds");
    expect(sheet).toHaveTextContent("Only if eligible under the policy");
    expect(sheet).toHaveTextContent(`No refunds for change of mind. ${REFUND_ACL_STATEMENT}`);
    expect(sheet).not.toHaveTextContent(/Change ticket holder name|Resend confirmation email|Contact organiser|Send ticket/);
    // The ✕ (from 768) and the sheet's Close button (below): one shows at any width.
    expect(within(sheet).getAllByRole("button", { name: "Close" })).toHaveLength(2);
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" })[0]);

    rerender(<MyTicketView order={ORDER} sessionId="ord_1" onSendTicket={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage order" }));
    sheet = screen.getByRole("dialog", { name: "Manage order" });
    fireEvent.click(within(sheet).getByRole("button", { name: /Send ticket to a friend/ }));
    expect(onSend).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the shown ticket's wallet badges are under it and follow the pager; an order without wallets has none, and no Apple note", () => {
    const { rerender } = render(<MyTicketView order={TWO} sessionId="ord_1" />);
    const labels = () => screen.getAllByRole("link", { name: /Wallet/ }).map((a) => a.getAttribute("aria-label"));
    expect(labels()).toEqual(["Add to Apple Wallet: ticket 1 of 2", "Add to Google Wallet: ticket 1 of 2"]);
    fireEvent.click(pagePager("Next ticket"));
    expect(labels()).toEqual(["Add to Apple Wallet: ticket 2 of 2", "Add to Google Wallet: ticket 2 of 2"]);
    expect(screen.getByText("To add your tickets to Apple Wallet, open this page on your iPhone or Mac.")).toBeInTheDocument();
    rerender(<MyTicketView order={{ ...TWO, wallet: undefined }} sessionId="ord_1" />);
    expect(screen.queryByRole("link", { name: /Wallet/ })).toBeNull();
    expect(screen.queryByText(/Apple Wallet, open this page/)).toBeNull();
  });

  it("an unlisted event: the ticket says so; no calendar, venue, event link, wallet badges or refund terms", () => {
    render(<MyTicketView order={{ ...ORDER, eventListed: false }} sessionId="ord_1" event={EVENT} />);
    expect(screen.getByRole("article")).toHaveTextContent("This event is no longer listed.");
    expect(screen.queryByRole("heading", { name: "Add to calendar" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Getting there" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View event page" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Wallet/ })).toBeNull();
    expect(document.querySelector("[data-refund-policy]")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });
});

describe("several tickets on the page: one at a time, at every width", () => {
  /** The codes of the tickets showing (the others are hidden on screen; they print). */
  const shown = () =>
    within(pageTickets())
      .getAllByRole("listitem")
      .filter((item) => !item.classList.contains("hidden"))
      .map((item) => within(item).getByRole("img").getAttribute("aria-label"));

  it("shows one ticket with Previous / Next round 'Ticket 1 of 2', said politely; Next shows the other; every ticket prints", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" />);
    const pager = pageTickets().querySelector("[data-ticket-pager]") as HTMLElement;
    expect(pager).toHaveClass("print:hidden");
    const label = pager.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(label).toHaveTextContent("Ticket 1 of 2");
    expect(label).toHaveAttribute("aria-atomic", "true");
    expect(shown()).toEqual(["QR code for ticket BPT7-7P6W"]);
    const hidden = within(pageTickets()).getAllByRole("listitem")[1];
    expect(hidden).toHaveClass("hidden", "print:block");
    fireEvent.click(pagePager("Next ticket"));
    expect(label).toHaveTextContent("Ticket 2 of 2");
    expect(shown()).toEqual(["QR code for ticket K4M2-9QXA"]);
    expect(within(pageTickets()).getAllByRole("button", { name: /^Show ticket/ })).toHaveLength(1);
    // The 44px targets of the full-screen pager, on the page's colours.
    expect(pagePager("Next ticket")).toHaveClass("min-h-11", "min-w-11", "text-foreground", "aria-disabled:text-muted");
  });

  it("keyboard focus stays on Previous / Next at either end: aria-disabled, not disabled, and a press there does nothing", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" />);
    const label = pageTickets().querySelector('[aria-live="polite"]') as HTMLElement;
    const previous = pagePager("Previous ticket");
    const next = pagePager("Next ticket");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveAttribute("aria-disabled", "false");
    next.focus();
    fireEvent.click(next);
    expect(label).toHaveTextContent("Ticket 2 of 2");
    expect(next).not.toBeDisabled();
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(label).toHaveTextContent("Ticket 2 of 2");
    expect(next).toHaveFocus();
    previous.focus();
    fireEvent.click(previous);
    expect(label).toHaveTextContent("Ticket 1 of 2");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(previous).toHaveFocus();
    fireEvent.click(previous);
    expect(label).toHaveTextContent("Ticket 1 of 2");
    expect(previous).toHaveFocus();
  });

  it("Show ticket opens the full-screen ticket on the one shown", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" />);
    fireEvent.click(pagePager("Next ticket"));
    fireEvent.click(screen.getByRole("button", { name: "Show ticket 2 of 2" }));
    const dialog = screen.getByRole("dialog", { name: "Your ticket" });
    expect(dialog.querySelector('[aria-live="polite"]')).toHaveTextContent("Ticket 2 of 2");
    const inView = within(dialog).getAllByRole("article").find((ticket) => !ticket.parentElement?.hasAttribute("inert")) as HTMLElement;
    expect(within(inView).getByRole("img", { name: "QR code for ticket K4M2-9QXA" })).toBeInTheDocument();
  });

  it("one ticket: no pager", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    expect(pageTickets().querySelector("[data-ticket-pager]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next ticket" })).toBeNull();
  });
});

describe("the full-screen ticket (phones)", () => {
  it("Show ticket is a phone-only primary button: orange with a black label, black with orange on hover", () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    expect(screen.getByRole("button", { name: "Show ticket" })).toHaveClass("md:hidden", "min-h-14", "bg-signal", "text-ink", "hover:bg-ink", "hover:text-signal");
  });

  it("opens the ticket large for scanning, keeps the screen awake while it's open, and lets it sleep after", async () => {
    render(<MyTicketView order={ORDER} sessionId="ord_1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show ticket" }));
    const dialog = screen.getByRole("dialog", { name: "Your ticket" });
    expect(dialog).toHaveClass("h-dvh", "w-screen", "bg-ink");
    expect(dialog.querySelector('[aria-live="polite"]')).toHaveTextContent("Ticket 1 of 1");
    const ticket = within(dialog).getByRole("article");
    expect(ticket).toHaveAttribute("data-ticket-size", "screen");
    expect(within(ticket).getByRole("img", { name: "QR code for ticket BPT7-7P6W" }).parentElement).toHaveClass("size-[231px]", "min-[375px]:size-[264px]");
    // One ticket: no pager.
    expect(within(dialog).queryByRole("button", { name: "Next ticket" })).toBeNull();
    // No sending yet, so no Send.
    expect(within(dialog).queryByRole("button", { name: "Send" })).toBeNull();
    // Its wallet badges are under it.
    expect(within(dialog).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["Add to Apple Wallet", "Add to Google Wallet"]);
    await waitFor(() => expect(requestScreenWakeLock).toHaveBeenCalledTimes(1));
    expect(document.documentElement.style.overflow).toBe("hidden");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close ticket" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("several tickets: opens on the one asked for; Previous and Next move between them and the bar says which", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" />);
    fireEvent.click(pagePager("Next ticket"));
    fireEvent.click(screen.getByRole("button", { name: "Show ticket 2 of 2" }));
    const dialog = screen.getByRole("dialog", { name: "Your ticket" });
    const bar = dialog.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(bar).toHaveTextContent("Ticket 2 of 2");
    expect(bar).toHaveAttribute("aria-live", "polite");
    const next = within(dialog).getByRole("button", { name: "Next ticket" });
    const previous = within(dialog).getByRole("button", { name: "Previous ticket" });
    expect(next).toHaveAttribute("aria-disabled", "true");
    // Only the ticket in view is reachable (the others are inert); its wallet links follow it.
    const inert = () => within(dialog).getAllByRole("article").map((ticket) => ticket.parentElement?.hasAttribute("inert"));
    expect(inert()).toEqual([true, false]);
    expect(within(dialog).getAllByRole("link")[0]).toHaveAttribute("aria-label", "Add to Apple Wallet: ticket 2 of 2");
    fireEvent.click(previous);
    expect(bar).toHaveTextContent("Ticket 1 of 2");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(inert()).toEqual([false, true]);
    expect(within(dialog).getAllByRole("link")[0]).toHaveAttribute("aria-label", "Add to Apple Wallet: ticket 1 of 2");
    expect(dialog.querySelectorAll("[data-ticket-dots] > span")).toHaveLength(2);
  });

  it("at the first and last ticket Previous and Next keep keyboard focus: aria-disabled, greyed, and a press does nothing", () => {
    render(<MyTicketView order={TWO} sessionId="ord_1" />);
    fireEvent.click(pagePager("Next ticket"));
    fireEvent.click(screen.getByRole("button", { name: "Show ticket 2 of 2" }));
    const dialog = screen.getByRole("dialog", { name: "Your ticket" });
    const bar = dialog.querySelector('[aria-live="polite"]') as HTMLElement;
    const previous = within(dialog).getByRole("button", { name: "Previous ticket" });
    const next = within(dialog).getByRole("button", { name: "Next ticket" });
    for (const button of [previous, next]) {
      expect(button).not.toBeDisabled();
      expect(button).toHaveClass("aria-disabled:text-muted");
    }
    expect(previous).toHaveAttribute("aria-disabled", "false");
    previous.focus();
    fireEvent.click(previous);
    expect(bar).toHaveTextContent("Ticket 1 of 2");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(previous).toHaveFocus();
    fireEvent.click(previous);
    expect(bar).toHaveTextContent("Ticket 1 of 2");
    expect(previous).toHaveFocus();
    next.focus();
    fireEvent.click(next);
    expect(bar).toHaveTextContent("Ticket 2 of 2");
    expect(next).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(next);
    expect(bar).toHaveTextContent("Ticket 2 of 2");
    expect(next).toHaveFocus();
  });

  it("the wake lock: a tab shown again before the first lock arrives holds one lock, and a lock that arrives after close is let go", async () => {
    const pending: Array<(lock: { release: typeof release }) => void> = [];
    const locks = [vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];
    requestScreenWakeLock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    try {
      render(<MyTicketView order={ORDER} sessionId="ord_1" />);
      fireEvent.click(screen.getByRole("button", { name: "Show ticket" }));
      expect(requestScreenWakeLock).toHaveBeenCalledTimes(1);
      expect(document.visibilityState).toBe("visible");
      // The tab comes back (visibilitychange) while the first request is still out: a second request.
      fireEvent(document, new Event("visibilitychange"));
      expect(requestScreenWakeLock).toHaveBeenCalledTimes(2);
      // The first lock arrives late: it's stale, so it's released at once.
      await act(async () => pending[0]({ release: locks[0] }));
      expect(locks[0]).toHaveBeenCalledTimes(1);
      await act(async () => pending[1]({ release: locks[1] }));
      expect(locks[1]).not.toHaveBeenCalled();
      // Shown again with a lock held: the held one goes before the next is asked for.
      fireEvent(document, new Event("visibilitychange"));
      expect(locks[1]).toHaveBeenCalledTimes(1);
      expect(requestScreenWakeLock).toHaveBeenCalledTimes(3);
      // Closed before that request answers: the lock it brings is let go, not kept.
      await act(async () => {
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close ticket" }));
      });
      await act(async () => pending[2]({ release: locks[2] }));
      expect(locks[2]).toHaveBeenCalledTimes(1);
      // Nothing listens once it's closed.
      fireEvent(document, new Event("visibilitychange"));
      expect(requestScreenWakeLock).toHaveBeenCalledTimes(3);
    } finally {
      requestScreenWakeLock.mockImplementation(async () => ({ release }));
    }
  });

  it("seated tickets shown by seat keep their own numbers: the bar, QR and wallet links all name the same ticket", () => {
    // Ticket 1 is in row B and ticket 2 in row A, so the seat order puts ticket 2 first.
    const seated: CustomerOrder = {
      ...TWO,
      tickets: [
        { ...TWO.tickets[0], seat: { section: "Stalls", row: "B", seat: "1", kind: "standard" } },
        { ...TWO.tickets[1], seat: { section: "Stalls", row: "A", seat: "1", kind: "standard" } },
      ],
    };
    render(<MyTicketView order={seated} sessionId="ord_1" />);
    // The page shows them by seat too: ticket 2 first, under its own number.
    expect(pageTickets().querySelector('[aria-live="polite"]')).toHaveTextContent("Ticket 2 of 2");
    const show = screen.getByRole("button", { name: /^Show ticket/ });
    expect(show).toHaveTextContent("Show ticket → 2 of 2");
    fireEvent.click(pagePager("Next ticket"));
    expect(pageTickets().querySelector('[aria-live="polite"]')).toHaveTextContent("Ticket 1 of 2");
    expect(show).toHaveTextContent("Show ticket → 1 of 2");
    fireEvent.click(pagePager("Previous ticket"));
    fireEvent.click(show);
    const dialog = screen.getByRole("dialog", { name: "Your ticket" });
    const bar = dialog.querySelector('[aria-live="polite"]') as HTMLElement;
    const inView = () => within(dialog).getAllByRole("article").find((ticket) => !ticket.parentElement?.hasAttribute("inert")) as HTMLElement;
    expect(bar).toHaveTextContent("Ticket 2 of 2");
    expect(within(inView()).getByRole("img", { name: "QR code for ticket K4M2-9QXA" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")[0]).toHaveAttribute("aria-label", "Add to Apple Wallet: ticket 2 of 2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next ticket" }));
    expect(bar).toHaveTextContent("Ticket 1 of 2");
    expect(within(inView()).getByRole("img", { name: "QR code for ticket BPT7-7P6W" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link")[0]).toHaveAttribute("aria-label", "Add to Apple Wallet: ticket 1 of 2");
  });

  it("Send shows in the bar once the page can send, for the ticket in view", () => {
    const onSend = vi.fn();
    render(<MyTicketView order={TWO} sessionId="ord_1" onSendTicket={onSend} />);
    fireEvent.click(pagePager("Next ticket"));
    fireEvent.click(screen.getByRole("button", { name: "Show ticket 2 of 2" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(2);
  });
});

describe("the demo's sample ticket (no API)", () => {
  it("shows a sample order for a sample event, priced with the real fee maths, with no wallet links", () => {
    render(<DemoTicket />);
    expect(screen.getByRole("heading", { level: 1, name: sample.event.title })).toBeInTheDocument();
    expect(screen.getByText("Order #DEMO0001 Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket K7QM-2XPD" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wallet/ })).toBeNull();
    const { order } = sample;
    expect(order.totalCents).toBe(order.subtotalCents + order.buyerFeeCents);
    expect(order.buyerFeeCents).toBe(Math.round(order.subtotalCents * 0.06) + 50);
  });
});
