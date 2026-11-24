// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect, type ComponentProps } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import { ApiError } from "@/lib/api/client";
import { orderAccessFor, rememberOrderAccess } from "@/lib/order-access";
import type { CustomerOrder, OrderPaymentLookup } from "@/lib/api/types";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
import { rememberPendingCheckout } from "@/lib/seating/pending-checkout";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

// The real next/link, marked, so a test can tell its links from plain ones (a full page load).
vi.mock("next/link", async (importOriginal) => {
  const { default: RealLink } = await importOriginal<typeof import("next/link")>();
  return { default: (props: ComponentProps<typeof RealLink>) => <RealLink {...props} data-next-link="" /> };
});
// The page's session_id: a test can move the tab to another order (and re-render).
let sessionParam = "cs_test_1";
// `?send=n` (a test sets it), and the router the page moves on with.
const extraParams: Record<string, string> = {};
const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ ...(sessionParam ? { session_id: sessionParam } : {}), ...extraParams }),
  useRouter: () => router,
}));
const getOrderBySession = vi.fn();
// The event's public details (image, address): optional extras the page works without; none by default.
const getPublicEventBySlug = vi.fn();
vi.mock("@/lib/api/public-events", () => ({ getPublicEventBySlug: (...args: unknown[]) => getPublicEventBySlug(...args) }));
// The live site (the demo, with no API, shows a sample ticket instead: tests/CheckoutSuccessPage.test.tsx, and DemoTicket in tests/MyTicketView.test.tsx).
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), isApiConfigured: true }));
const getOrderPayment = vi.fn();
const changeOrderEmail = vi.fn();
// The writes the page must never make (it only reads).
const writes = { createCheckoutSession: vi.fn(), confirmFreeOrder: vi.fn(), cancelPendingOrder: vi.fn() };
vi.mock("@/lib/api/orders", async (importOriginal) => ({
  // A pure URL builder (the wallet buttons' links): the real one.
  walletPassUrl: (await importOriginal<typeof import("@/lib/api/orders")>()).walletPassUrl,
  getOrderBySession: (...args: unknown[]) => getOrderBySession(...args),
  getOrderPayment: (...args: unknown[]) => getOrderPayment(...args),
  changeOrderEmail: (...args: unknown[]) => changeOrderEmail(...args),
  createCheckoutSession: (...args: unknown[]) => writes.createCheckoutSession(...args),
  confirmFreeOrder: (...args: unknown[]) => writes.confirmFreeOrder(...args),
}));
// The signed-in member's profile (the Send dialog's "Your name"): none unless a test sets one.
const nav: { account: { profile: { displayName: string } | null } | null } = { account: null };
vi.mock("@/components/nav/useNavAccount", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/nav/useNavAccount")>()),
  useOptionalNavAccount: () => nav.account,
}));
const sendTicket = vi.fn();
const cancelTicketTransfer = vi.fn();
vi.mock("@/lib/api/ticket-transfers", () => ({
  sendTicket: (...args: unknown[]) => sendTicket(...args),
  cancelTicketTransfer: (...args: unknown[]) => cancelTicketTransfer(...args),
}));
vi.mock("@/lib/api/seating", () => ({
  cancelPendingOrder: (...args: unknown[]) => writes.cancelPendingOrder(...args),
}));

// jsdom has no modal dialogs: give <dialog> what a browser would (the page's sheets and full-screen ticket).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  getPublicEventBySlug.mockRejectedValue(new Error("not loaded in this test"));
});

afterEach(() => {
  cleanup();
  getPublicEventBySlug.mockReset();
  sessionParam = "cs_test_1";
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
  getOrderBySession.mockReset();
  getOrderPayment.mockReset();
  sendTicket.mockReset();
  cancelTicketTransfer.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  for (const key of Object.keys(extraParams)) delete extraParams[key];
  nav.account = null;
  changeOrderEmail.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
});

const ORDER: CustomerOrder = {
  status: "paid",
  reference: "#7C1F2E0A",
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  maskedEmail: "m***@example.com",
  subtotalCents: 3000,
  buyerFeeCents: 230,
  totalCents: 3230,
  tickets: [{ ticketCode: "ABC123", ticketTypeName: "General admission", checkedInAt: null }],
};

/** What the current API returns for a paid order: the event's details and each ticket's check-in status. */
const WITH_DETAILS: CustomerOrder = {
  ...ORDER,
  eventStartsAt: "2027-03-06T09:00:00.000Z", // 8:00 pm AEDT
  eventEndsAt: "2027-03-06T12:30:00.000Z",
  venueName: "The Tote",
  suburb: "Collingwood",
  tickets: [
    { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: "2027-03-06T09:42:00.000Z" },
    { ticketCode: "A2B3-C4D5", ticketTypeName: "VIP", checkedInAt: null },
  ],
};

describe("CheckoutConfirmation", () => {
  it("links back to the event and to its Who's Going panel", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Add yourself to Who’s Going" })).toHaveAttribute(
      "href",
      "/events/neon-static#whos-going",
    );
    expect(screen.getByRole("link", { name: "View event page" })).toHaveAttribute("href", "/events/neon-static");
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    // This browser has no order access token for it: none is sent.
    expect(getOrderBySession).toHaveBeenCalledWith("cs_test_1", undefined);
  });

  it("shows the masked email and the order reference, never a full address", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("Tickets sent to m***@example.com.")).toBeInTheDocument();
    // A machine code: the reference stays in mono (owner decision, 13 Nov 2026) in the order line, with the order's
    // status in words; it's also the Ticket details' ORDER row.
    expect(screen.getByText("Order #7C1F2E0A Confirmed")).toHaveClass("font-mono");
    expect(screen.getByText("Order", { selector: "dt" }).nextElementSibling).toHaveTextContent(/^#7C1F2E0A$/);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/mia@/);
  });

  it("shows the total paid in the Ticket details card (label left, value right), and the order's lines in the receipt", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    const totalTerm = await screen.findByText("Total paid");
    const totalValue = totalTerm.nextElementSibling;
    expect(totalValue).toHaveTextContent(/^A\$32\.30 incl\. fees$/);
    expect(totalValue).toHaveClass("label-button", "tabular-nums");
    expect(totalTerm.parentElement).toHaveClass("justify-between", "border-t", "border-surface-border");
    const card = totalTerm.closest("section");
    expect(card).toHaveClass("rounded-control", "border", "border-surface-border", "bg-card", "p-6");
    expect(within(card as HTMLElement).getByRole("heading", { level: 2, name: "Ticket details" })).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Ticket", { selector: "dt" }).nextElementSibling).toHaveTextContent("General admission · 1 of 1");
    // The receipt is closed until asked for.
    expect(screen.queryByText("Booking fee")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
    const receipt = screen.getByRole("dialog", { name: "Order #7C1F2E0A" });
    expect(within(receipt).getByText("1 × General admission").nextElementSibling).toHaveTextContent("A$30");
    expect(within(receipt).getByText("Booking fee").nextElementSibling).toHaveClass("tabular-nums");
    expect(within(receipt).getByText("Booking fee").nextElementSibling).toHaveTextContent("A$2.30");
    expect(within(receipt).getByText("Total paid").nextElementSibling).toHaveTextContent("A$32.30");
  });

  it("a free order says Free, and has no receipt or refund row to open", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, subtotalCents: 0, buyerFeeCents: 0, totalCents: 0 });
    render(<CheckoutConfirmation />);
    expect((await screen.findByText("Total paid")).nextElementSibling).toHaveTextContent(/^Free$/);
    expect(screen.queryByRole("button", { name: "View receipt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage order" })).toBeNull();
  });

  it("without an event slug (an older API), only links home", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, eventSlug: undefined });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "View event page" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
  });

  it("shows a QR and the text code for each ticket, numbered as in the email, with the door advice", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      tickets: [
        { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" },
        { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission" },
      ],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
    expect(screen.getByText("7KQM-2HXD")).toBeInTheDocument();
    expect(screen.getByText("A2B3-C4D5")).toBeInTheDocument();
    expect(screen.getByText("Show this at the door · ticket 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Show this at the door · ticket 2 of 2")).toBeInTheDocument();
    expect(screen.getAllByText("Turn your brightness up. If the QR code won’t scan, door staff can type in the backup code.")).toHaveLength(2);
    expect(screen.getByText("Screenshot your codes in case signal drops at the venue.")).toBeInTheDocument();
    expect(screen.getByText("Each code works once. Don’t share it.")).toBeInTheDocument();
    expect(screen.queryByText("Show this page or your ticket email at the door.")).toBeNull();
  });

  it("shows a code that isn't a real one as text only, with no QR", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("tells the buyer a paid order was refunded and shows no codes", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.getByText(/tickets for this order are no longer valid/)).toBeInTheDocument();
    expect(screen.queryByText(/no tickets were issued/)).toBeNull();
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("shows no QR or code for a refunded order, even if a response still carried its tickets", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      status: "refunded",
      refundReason: "refunded",
      tickets: [{ ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" }],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("7KQM-2HXD")).toBeNull();
    expect(screen.queryByText(/Show a QR code at the door/)).toBeNull();
  });

  it("shows each ticket's event, date, venue, type, QR, backup code and status", async () => {
    getOrderBySession.mockResolvedValue(WITH_DETAILS);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    const tickets = screen.getAllByRole("listitem");
    expect(tickets).toHaveLength(2);
    for (const [i, ticket] of tickets.entries()) {
      const text = ticket.textContent ?? "";
      expect(text).toContain("Neon Static");
      expect(text).toContain("DateSat 6 Mar");
      expect(text).toContain("Time8–11:30 pm");
      expect(text).toContain("The Tote · Collingwood");
      expect(text).toContain("Backup code");
      expect(text).toContain(WITH_DETAILS.tickets[i].ticketCode);
    }
    expect(tickets[0].textContent).toContain("TicketGeneral admission");
    expect(tickets[0].textContent).toContain("ticket 1 of 2");
    expect(tickets[0].textContent).toMatch(/Checked in(Sat 6 Mar( 2027)?, )?8:42 pm · Enjoy the night/);
    expect(tickets[1].textContent).toContain("TicketVIP");
    expect(tickets[1].textContent).toContain("ticket 2 of 2");
    expect(tickets[1].textContent).not.toContain("Checked in");
    // The page's own date line, as the frames write it, and the venue.
    expect(screen.getByText("Sat 6 Mar · 8:00 – 11:30 pm AEDT")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Getting there" }).closest("section")).toHaveTextContent("The ToteCollingwood, VIC");
    // Both keep their QR.
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
  });

  it("shows a Perth event's date, check-in time and refund deadline in Perth time, and names it", async () => {
    getOrderBySession.mockResolvedValue({
      ...WITH_DETAILS,
      eventListed: true,
      eventTimeZone: "Australia/Perth",
      eventState: "WA",
      refundPolicy: "days_before",
      refundDays: 7,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-01T00:00:00.000Z"));
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    const tickets = screen.getAllByRole("listitem");
    // 8:00 pm – 11:30 pm AEDT is 5:00 pm – 8:30 pm AWST; checked in 8:42 pm AEDT is 5:42 pm AWST.
    for (const ticket of tickets) expect(ticket.textContent).toContain("DateSat 6 MarTime5–8:30 pm");
    expect(screen.getByText("Sat 6 Mar · 5:00 – 8:30 pm Perth time (AWST)")).toBeInTheDocument();
    expect(tickets[0].textContent).toMatch(/Checked in(Sat 6 Mar( 2027)?, )?5:42 pm/);
    expect(screen.getByText("Refunds available until Sat 27 Feb, 5:00 pm (7 days before the event).")).toBeInTheDocument();
  });

  it("from an older API (no event details or check-in status), shows the tickets without them", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      tickets: [{ ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" }],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("7KQM-2HXD")).toBeInTheDocument();
    expect(screen.getByText("Show this at the door · ticket 1 of 1")).toBeInTheDocument();
    expect(screen.queryByText(/Checked in/)).toBeNull();
    expect(screen.getByRole("listitem").textContent).not.toMatch(/Collingwood|8:00 pm|Date|Time/);
    expect(screen.queryByRole("heading", { name: "Getting there" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add to calendar" })).toBeNull();
  });

  it("shows a refunded order's refund copy, with no QR, date or venue, whatever the response carried", async () => {
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, status: "refunded", refundReason: "refunded" });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Checked in|Ready to scan|Backup code/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/7KQM-2HXD|The Tote/);
  });

  it("for an event that's no longer listed, keeps the tickets and QRs but shows the support line instead of its date and venue", async () => {
    // A buggy or older response that still carried details must not show them either.
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: false });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
    const tickets = screen.getAllByRole("listitem");
    expect(tickets).toHaveLength(2);
    for (const [i, ticket] of tickets.entries()) {
      const text = ticket.textContent ?? "";
      expect(text).toContain("Neon Static");
      expect(text).toContain(
        "This event is no longer listed. Contact support@sheltuh.com.au if you have questions.",
      );
      expect(text).toContain(WITH_DETAILS.tickets[i].ticketCode);
      expect(text).not.toMatch(/8:00 pm|Sat 6 Mar, |The Tote|Collingwood/);
    }
    for (const link of screen.getAllByRole("link", { name: "support@sheltuh.com.au" })) {
      expect(link).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    }
    // The event's page is gone: no links to it.
    expect(screen.queryByRole("link", { name: "Back to the event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });

  it("a listed event (eventListed true) shows its details and no support line", async () => {
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: true });
    render(<CheckoutConfirmation />);
    // On each ticket and in the page's title group.
    expect(await screen.findAllByText("The Tote · Collingwood")).toHaveLength(3);
    expect(screen.queryByText(/no longer listed/)).toBeNull();
    expect(screen.getByRole("link", { name: "View event page" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("shows the event's refund policy by the totals, dated from its start, with the ACL line and how to ask for a refund", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    try {
      getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: true, refundPolicy: "days_before", refundDays: 14 });
      render(<CheckoutConfirmation />);
      await screen.findByText("Total paid");
      const refunds = document.querySelector<HTMLElement>("[data-refund-policy]");
      if (!refunds) throw new Error("no refund policy");
      // The event starts Sat 6 Mar 2027, 8:00 pm AEDT.
      expect(refunds).toHaveTextContent(
        "Refund policy: Refunds available until Sat 20 Feb 2027, 8:00 pm (14 days before the event).",
      );
      expect(within(refunds).getByText(REFUND_ACL_STATEMENT)).toBeInTheDocument();
      expect(refunds.parentElement).toHaveClass("body-s", "text-muted");
      expect(screen.getByRole("link", { name: "Request a refund" })).toHaveAttribute("href", "/refunds");
      // After the total.
      expect(screen.getByText("Total paid").compareDocumentPosition(refunds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says no_change_of_mind too", async () => {
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, refundPolicy: "no_change_of_mind" });
    render(<CheckoutConfirmation />);
    await screen.findByText("Total paid");
    expect(document.querySelector("[data-refund-policy]")).toHaveTextContent("Refund policy: No refunds for change of mind.");
  });

  it("no refund line without a policy (an older API, an unlisted event), for a free order, or with invalid days", async () => {
    for (const order of [
      WITH_DETAILS,
      { ...WITH_DETAILS, eventListed: false, refundPolicy: "no_change_of_mind" as const },
      { ...WITH_DETAILS, subtotalCents: 0, buyerFeeCents: 0, totalCents: 0, refundPolicy: "no_change_of_mind" as const },
      { ...WITH_DETAILS, refundPolicy: "days_before" as const },
    ]) {
      getOrderBySession.mockResolvedValue(order);
      render(<CheckoutConfirmation />);
      await screen.findByText("Total paid");
      expect(document.querySelector("[data-refund-policy]")).toBeNull();
      expect(screen.queryByText(REFUND_ACL_STATEMENT)).toBeNull();
      cleanup();
    }
  });

  describe("wallet buttons (CustomerOrder.wallet)", () => {
    const walletLinks = () => screen.queryAllByRole("link", { name: /^Add to (Apple|Google) Wallet/ });

    it("none without the flags (an older API), or with both off", async () => {
      for (const order of [{ ...WITH_DETAILS, eventListed: true }, { ...WITH_DETAILS, eventListed: true, wallet: { google: false, apple: false } }]) {
        getOrderBySession.mockResolvedValue(order);
        render(<CheckoutConfirmation />);
        expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
        expect(walletLinks()).toHaveLength(0);
        cleanup();
      }
    });

    it("per ticket, only the wallets that are on, each to its pass route by the ticket's number (the API's order)", async () => {
      getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: true, wallet: { google: true, apple: false } });
      render(<CheckoutConfirmation />);
      await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" });
      // One ticket shows at a time: its badges are the ones under it, and they follow the pager.
      const shown = () => walletLinks().map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]);
      expect(shown()).toEqual([["Add to Google Wallet: ticket 1 of 2", "/api/orders/by-session/cs_test_1/wallet/google?ticket=1"]]);
      fireEvent.click(screen.getByRole("button", { name: "Next ticket" }));
      expect(shown()).toEqual([["Add to Google Wallet: ticket 2 of 2", "/api/orders/by-session/cs_test_1/wallet/google?ticket=2"]]);
      expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("TicketVIP");
      // Apple's device note is only for Apple's badge.
      expect(screen.queryByText(/Apple Wallet, open this page/)).toBeNull();
      cleanup();

      getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: true, wallet: { google: true, apple: true } });
      render(<CheckoutConfirmation />);
      await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" });
      const hrefs = () => walletLinks().map((a) => a.getAttribute("href"));
      expect(hrefs()).toEqual(["/api/orders/by-session/cs_test_1/wallet/apple?ticket=1", "/api/orders/by-session/cs_test_1/wallet/google?ticket=1"]);
      fireEvent.click(screen.getByRole("button", { name: "Next ticket" }));
      expect(hrefs()).toEqual(["/api/orders/by-session/cs_test_1/wallet/apple?ticket=2", "/api/orders/by-session/cs_test_1/wallet/google?ticket=2"]);
      // Apple's badge rules: once, under the badges, how to add them from a device without Wallet.
      expect(screen.getAllByText("To add your tickets to Apple Wallet, open this page on your iPhone or Mac.")).toHaveLength(1);
    });

    it("seated tickets are listed by seat but keep their numbers, so each link is the route's ticket", async () => {
      getOrderBySession.mockResolvedValue({
        ...WITH_DETAILS,
        eventListed: true,
        wallet: { google: false, apple: true },
        tickets: [
          { ticketCode: "7KQM-2HXD", ticketTypeName: "Stalls", checkedInAt: null, seat: { section: "Stalls", row: "B", seat: "4", kind: "standard" } },
          { ticketCode: "A2B3-C4D5", ticketTypeName: "Stalls", checkedInAt: null, seat: { section: "Stalls", row: "A", seat: "9", kind: "standard" } },
        ],
      });
      render(<CheckoutConfirmation />);
      await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" });
      // Row A (ticket 2 in the API's order) is shown first, and its link still asks for ticket 2; Next shows ticket 1.
      const shown = () => walletLinks().map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")]);
      expect(shown()).toEqual([["Add to Apple Wallet: ticket 2 of 2", "/api/orders/by-session/cs_test_1/wallet/apple?ticket=2"]]);
      fireEvent.click(screen.getByRole("button", { name: "Next ticket" }));
      expect(shown()).toEqual([["Add to Apple Wallet: ticket 1 of 2", "/api/orders/by-session/cs_test_1/wallet/apple?ticket=1"]]);
    });

    it("none for an event that's no longer listed, even if a response carried the flags", async () => {
      getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: false, wallet: { google: true, apple: true } });
      render(<CheckoutConfirmation />);
      expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
      expect(walletLinks()).toHaveLength(0);
    });

    it("none for a refunded order", async () => {
      getOrderBySession.mockResolvedValue({ ...ORDER, status: "refunded", refundReason: "refunded", tickets: [], wallet: { google: true, apple: true } });
      render(<CheckoutConfirmation />);
      expect(
        await screen.findByText("Your payment for Neon Static was refunded, so the tickets for this order are no longer valid."),
      ).toBeInTheDocument();
      expect(walletLinks()).toHaveLength(0);
    });
  });

  it("keeps the sold-out wording for an oversold refund", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "oversold_refund_required", refundReason: "oversold", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("We couldn\u2019t reserve your tickets")).toBeInTheDocument();
    expect(screen.getByText(/No tickets were issued/)).toBeInTheDocument();
  });
});

describe("CheckoutConfirmation: back from Stripe without a confirmed order (checkout-pay.md §5.5)", () => {
  /** Renders with the order still pending, and lets `polls` polls (2s apart) happen. */
  async function renderPending(polls: number) {
    vi.useFakeTimers();
    getOrderBySession.mockResolvedValue({ status: "pending" });
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 1; i < polls; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
  }

  function noWrites() {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  }

  it("asks Stripe's side only after two pending polls", async () => {
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: false });
    await renderPending(1);
    expect(getOrderPayment).not.toHaveBeenCalled();
    expect(screen.queryByText("This only takes a moment.")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    expect(getOrderPayment).toHaveBeenCalledWith("cs_test_1");
  });

  it("still open: payment not completed, back to the payment page, and polling stops", async () => {
    getOrderPayment.mockResolvedValue({
      status: "open",
      clientSecret: "cs_secret",
      expiresAt: "2027-03-06T09:31:00.000Z",
      eventTitle: "Neon Static",
      eventSlug: "neon-static",
      seated: false,
      lines: [],
      subtotalCents: 3000,
      buyerFeeCents: 230,
      totalCents: 3230,
    });
    await renderPending(2);
    const h1 = screen.getByRole("heading", { level: 1, name: "Payment not completed" });
    expect(h1).toHaveFocus();
    // The tab says so too, never "Order confirmed". (Fake timers here, so not waitFor: the
    // effect that sets it has already run inside renderPending's act.)
    expect(document.title).toBe("Payment not completed — Sheltüh");
    expect(
      screen.getByText("You haven’t been charged."),
    ).toBeInTheDocument();
    // Focused by script, not a control: no ring. Balanced, as every message's h1.
    expect(h1).toHaveClass("focus:outline-none!", "text-balance");
    const again = screen.getByRole("link", { name: "Return to payment" });
    expect(again.tagName).toBe("A");
    expect(again).toHaveAttribute("href", "/checkout/pay?order=cs_test_1");
    expect(again).toHaveClass("btn", "btn-solid", "btn-lg", "w-full", "sm:w-auto");
    expect(again.parentElement).toHaveClass("mt-3");
    // A plain link, so a full page load: /checkout/pay gets its own document and Content Security Policy.
    expect(again).not.toHaveAttribute("data-next-link");
    const back = screen.getByRole("link", { name: "Back to the event" });
    expect(back).toHaveAttribute("href", "/events/neon-static");
    // The page's other links stay client-side (and prove the marker below works).
    expect(back).toHaveAttribute("data-next-link");
    // Never the client secret on screen.
    expect(document.body.textContent).not.toContain("cs_secret");
    const polls = getOrderBySession.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getOrderBySession.mock.calls.length).toBe(polls);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it("still open, seated with no event page: says when the seats are held until, and goes home", async () => {
    getOrderPayment.mockResolvedValue({
      status: "open",
      clientSecret: "cs_secret",
      expiresAt: "2027-03-06T09:31:00.000Z", // 8:31 pm AEDT
      eventTitle: "Off-Kilter",
      seated: true,
      lines: [],
      subtotalCents: 3000,
      buyerFeeCents: 230,
      totalCents: 3230,
    });
    await renderPending(2);
    expect(
      screen.getByText(
        "You haven’t been charged. Your seats are held until 8:31 pm Melbourne time.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });

  it("still open, seated, at a Perth event: the hold ends in Perth time, and says so", async () => {
    getOrderPayment.mockResolvedValue({
      status: "open",
      clientSecret: "cs_secret",
      expiresAt: "2027-03-06T09:31:00.000Z", // 8:31 pm AEDT, 5:31 pm AWST
      eventTitle: "Off-Kilter",
      eventTimeZone: "Australia/Perth",
      eventState: "WA",
      seated: true,
      lines: [],
      subtotalCents: 3000,
      buyerFeeCents: 230,
      totalCents: 3230,
    });
    await renderPending(2);
    expect(screen.getByText(/Your seats are held until 5:31 pm Perth time\.$/)).toBeInTheDocument();
  });

  it("processing: keeps polling, then says the payment is processing (not an error)", async () => {
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: true });
    await renderPending(12);
    const h1 = screen.getByRole("heading", { level: 1, name: "Your payment is processing" });
    expect(h1).toHaveFocus();
    const body = screen.getByText(
      "We’ll email your tickets once it clears. You won’t be charged twice.",
    );
    expect(body).toHaveClass("text-muted");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(getOrderBySession).toHaveBeenCalledTimes(12);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it("the check failing changes nothing: polling carries on to today's timeout message", async () => {
    getOrderPayment.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderPending(12);
    expect(screen.getByRole("alert")).toHaveTextContent("Your payment is taking longer than usual to confirm.");
  });

  it("closed: says so, with the way back to the event", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: true });
    await renderPending(2);
    expect(screen.getByRole("heading", { level: 1, name: "This checkout has closed" })).toHaveFocus();
    expect(
      screen.getByText(
        "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("unconfirmed (the server couldn't ask Stripe): keeps polling, and the paid order still shows if the webhook lands", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", reason: "unconfirmed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: true });
    getOrderBySession
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValue(ORDER);
    vi.useFakeTimers();
    render(<CheckoutConfirmation />);
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 2000);
      });
    }
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });

  it("unconfirmed and never paid: says it couldn't confirm the payment (never 'not charged'), with the way back to the event", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", reason: "unconfirmed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: true });
    await renderPending(12);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toHaveFocus();
    expect(screen.getByText("Check your email for tickets before trying again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    expect(document.body.textContent).not.toMatch(/haven’t been charged/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(getOrderBySession).toHaveBeenCalledTimes(12);
    expect(document.title).toBe("Payment not confirmed — Sheltüh");
    noWrites();
  });

  it("sold out, seated: choose other seats", async () => {
    getOrderPayment.mockResolvedValue({ status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true });
    await renderPending(2);
    expect(screen.getByRole("heading", { level: 1, name: "These tickets have just sold out" })).toHaveFocus();
    expect(
      screen.getByText(
        "Some of your seats were booked by someone else while this checkout was open. You haven’t been charged. Choose other seats to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose other seats" })).toHaveAttribute("href", "/events/off-kilter/seats");
    noWrites();
  });

  it("sold out, general admission: back to the event", async () => {
    getOrderPayment.mockResolvedValue({ status: "sold_out", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    await renderPending(2);
    expect(
      screen.getByText("Someone else booked the last ones while this checkout was open. You haven’t been charged."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("paid by the next poll: the tickets, and the payment isn't asked about", async () => {
    getOrderBySession.mockResolvedValueOnce({ status: "pending" }).mockResolvedValue(ORDER);
    vi.useFakeTimers();
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(getOrderPayment).not.toHaveBeenCalled();
  });
});

describe("CheckoutConfirmation: the seat page's pending checkout (released on Back until the order settles)", () => {
  const KEY = "sheltuh:pending-checkout";
  const OPEN: OrderPaymentLookup = {
    status: "open",
    clientSecret: "cs_secret",
    expiresAt: "2027-03-06T09:31:00.000Z",
    eventTitle: "Off-Kilter",
    eventSlug: "off-kilter",
    seated: true,
    lines: [],
    subtotalCents: 3000,
    buyerFeeCents: 230,
    totalCents: 3230,
  };

  beforeEach(() => {
    // The seat page stored this order as it went to pay (the page's session_id is the order id).
    rememberPendingCheckout("cs_test_1", "off-kilter");
  });

  async function settle(polls: number) {
    vi.useFakeTimers();
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 1; i < polls; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
  }

  it("isn't forgotten just by arriving: while the order is still pending, it's kept", async () => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockReturnValue(new Promise(() => undefined));
    await settle(1);
    expect(screen.queryByText("This only takes a moment.")).toBeNull();
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });

  it.each([
    ["payment not completed (still open)", OPEN, "Payment not completed"],
    ["closed", { status: "closed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true }, "This checkout has closed"],
    ["sold out", { status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true }, "These tickets have just sold out"],
  ] as const)("%s: kept, so Back to the seat page still releases the seats", async (_name, answer, title) => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockResolvedValue(answer);
    await settle(2);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });

  it("paid: forgotten", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "paid" });
    await settle(1);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([["oversold_refund_required"], ["refunded"]] as const)("%s: forgotten", async (status) => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status, tickets: [] });
    await settle(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/refunded|couldn’t reserve/);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("processing (Stripe has the payment): forgotten", async () => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: true });
    await settle(11);
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Your payment is processing" })).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("an error (couldn't load the order): kept", async () => {
    getOrderBySession.mockRejectedValue(new TypeError("Failed to fetch"));
    await settle(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your order right now.");
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });
});

describe("CheckoutConfirmation: the tab's title follows the answer", () => {
  afterEach(() => {
    document.title = "";
  });

  it("the route's own title is neutral (it can also say a payment wasn't completed)", async () => {
    const { metadata } = await import("@/app/checkout/success/page");
    expect(metadata.title).toBe("Your order — Sheltüh");
  });

  it("leaves it while confirming, then says Order confirmed only for a paid order", async () => {
    document.title = "Your order — Sheltüh";
    let resolve: (order: CustomerOrder) => void = () => {};
    getOrderBySession.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<CheckoutConfirmation />);
    expect(document.title).toBe("Your order — Sheltüh");
    await act(async () => resolve(ORDER));
    await waitFor(() => expect(document.title).toBe("Order confirmed — Sheltüh"));
  });

  it.each<[string, () => void, string]>([
    ["not found", () => getOrderBySession.mockRejectedValue(new ApiError(404, "Not found.")), "Order not found — Sheltüh"],
    ["an error", () => getOrderBySession.mockRejectedValue(new Error("boom")), "Something went wrong — Sheltüh"],
    ["a refund", () => getOrderBySession.mockResolvedValue({ ...ORDER, status: "refunded", refundReason: "refunded" }), "Order refunded — Sheltüh"],
  ])("%s: %j", async (_, arrange, title) => {
    arrange();
    render(<CheckoutConfirmation />);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(document.title).toBe(title));
  });
});

describe("CheckoutConfirmation: Support Sheltüh", () => {
  it("is its own line in the totals, in the total paid, with a thank-you", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, supportCents: 500, totalCents: 3730 });
    render(<CheckoutConfirmation />);
    // The page's total includes it; its own line is in the receipt.
    expect((await screen.findByText("Total paid")).nextElementSibling).toHaveTextContent("A$37.30 incl. fees");
    fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
    const receipt = within(screen.getByRole("dialog", { name: "Order #7C1F2E0A" }));
    const term = receipt.getByText("Support Sheltüh", { selector: "dt" });
    expect(term.nextElementSibling).toHaveTextContent("A$5");
    expect(term.nextElementSibling).toHaveClass("tabular-nums");
    // After the booking fee, before the total paid (which includes it).
    const totalTerm = receipt.getByText("Total paid");
    expect(receipt.getByText("Booking fee").compareDocumentPosition(term) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(term.compareDocumentPosition(totalTerm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(totalTerm.nextElementSibling).toHaveTextContent("A$37.30");
    expect(screen.getByText("Thanks for supporting Sheltüh.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/donat/i);
  });

  it("isn't there without it (unset, or from an older API)", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    await screen.findByText("Total paid");
    fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
    expect(screen.getByRole("dialog", { name: "Order #7C1F2E0A" })).toHaveTextContent("Booking fee");
    expect(screen.queryByText("Support Sheltüh")).toBeNull();
    expect(screen.queryByText("Thanks for supporting Sheltüh.")).toBeNull();
  });

  it("with support, the refund terms say it's refunded only with the whole order; not without it", async () => {
    const note = "Support Sheltüh is refunded only if your whole order is refunded.";
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, refundPolicy: "no_change_of_mind", supportCents: 500 });
    const { unmount } = render(<CheckoutConfirmation />);
    const policy = (await screen.findByText(/No refunds for change of mind/)).closest("[data-refund-policy]") as HTMLElement;
    expect(within(policy).getByText(note)).toBeInTheDocument();
    unmount();

    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, refundPolicy: "no_change_of_mind" });
    render(<CheckoutConfirmation />);
    await screen.findByText(/No refunds for change of mind/);
    expect(screen.queryByText(note)).toBeNull();
  });
});

describe("CheckoutConfirmation: group tickets", () => {
  const GROUP_ORDER: CustomerOrder = {
    ...ORDER,
    subtotalCents: 12000,
    buyerFeeCents: 770,
    totalCents: 12770,
    tickets: [1, 2, 3, 4].map((position) => ({
      ticketCode: `GRP${position}-AAAA`,
      ticketTypeName: "Group of 4",
      checkedInAt: null,
      group: { position, size: 4 },
    })),
  };

  it("lists a ticket for each person, each named by its place in the group, and counts the tickets", async () => {
    getOrderBySession.mockResolvedValue(GROUP_ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("region", { name: "Your tickets (4)" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("TicketGroup of 4 (1 of 4)");
    expect(items[0]).toHaveTextContent("Show this at the door · ticket 1 of 4");
    expect(items[3]).toHaveTextContent("TicketGroup of 4 (4 of 4)");
    expect(items[3]).toHaveTextContent("Show this at the door · ticket 4 of 4");
    // Group tickets aren't "4 × Group of 4": the details say how many tickets the order holds.
    const details = screen.getByRole("heading", { level: 2, name: "Ticket details" }).closest("section") as HTMLElement;
    expect(within(details).getByText("Ticket", { selector: "dt" }).nextElementSibling).toHaveTextContent(/^4 tickets$/);
  });

  it("an order of single tickets keeps its plain name", async () => {
    getOrderBySession.mockResolvedValue(WITH_DETAILS);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("region", { name: "Your tickets" })).toBeInTheDocument();
  });
});


describe("CheckoutConfirmation: the buyer's email (the paying browser's one change)", () => {
  const TOKEN = "ab".repeat(32);
  const PAYING: CustomerOrder = { ...ORDER, maskedEmail: undefined, email: "mia@gmail.con", emailChange: { allowed: true } };

  function asPayingBrowser() {
    rememberOrderAccess("cs_test_1", TOKEN);
  }

  /** A paragraph whose whole text (its support link included) matches `words`. */
  function paragraph(words: RegExp) {
    return (_content: string, el: Element | null) => el?.tagName === "P" && words.test(el.textContent ?? "");
  }

  it("sends this browser's token on the read, shows the full email, and changes it once", async () => {
    asPayingBrowser();
    // A listed event's order, with its wallet buttons: the change's answer keeps them (the server's withWallet).
    const wallet = { ...PAYING, eventListed: true, wallet: { google: true, apple: false } } satisfies CustomerOrder;
    getOrderBySession.mockResolvedValue(wallet);
    changeOrderEmail.mockResolvedValue({
      result: "changed",
      order: { ...wallet, email: "mia@gmail.com", emailChange: { allowed: false, reason: "email_already_changed" } },
    });
    render(<CheckoutConfirmation />);
    const line = await screen.findByText((_c, el) => el?.tagName === "P" && el.textContent === "Tickets sent to mia@gmail.con.");
    expect(line).toBeInTheDocument();
    // A long address wraps only where it must (not mid-word everywhere, as break-all did).
    expect(within(line).getByText("mia@gmail.con")).toHaveClass("wrap-anywhere");
    expect(within(line).getByText("mia@gmail.con")).not.toHaveClass("break-all");
    expect(getOrderBySession).toHaveBeenCalledWith("cs_test_1", TOKEN);

    const open = screen.getByRole("button", { name: "Wrong email? Change it" });
    expect(open).toHaveClass("min-h-11");
    fireEvent.click(open);
    const field = screen.getByLabelText("New email for your tickets");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue("mia@gmail.con");
    // In a form: the phone keyboard's key says Send, and Enter sends it (focus stays on the field meanwhile).
    expect(field).toHaveAttribute("enterkeyhint", "send");
    fireEvent.change(field, { target: { value: " mia@gmail.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));

    await waitFor(() => expect(changeOrderEmail).toHaveBeenCalledWith("cs_test_1", "mia@gmail.com", TOKEN, undefined));
    // One line, said once: what happened, where the tickets are going, and how to change it again.
    const status = await screen.findByRole("status");
    await waitFor(() =>
      expect(status).toHaveTextContent(
        "Email changed. Tickets are on their way to mia@gmail.com. To change it again, contact support@sheltuh.com.au.",
      ),
    );
    expect(within(status).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(screen.queryByText(/Tickets sent to/)).toBeNull();
    expect(screen.queryByText(/You’ve already changed this email once/)).toBeNull();
    expect(screen.getAllByText(/Email changed/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    // Focus isn't lost with the form: it's on the box, whose short name doesn't repeat the status.
    await waitFor(() => expect(screen.getByRole("group", { name: "Ticket email" })).toHaveFocus());
    // The wallet buttons are still there after the change.
    expect(screen.getByRole("link", { name: /^Add to Google Wallet/ })).toBeInTheDocument();
    // The buyer's own change used up: the token stays (only an ended event, a scan or support's change drop it).
    expect(orderAccessFor("cs_test_1")).toBe(TOKEN);
    // The token never reaches the page's text or the address bar.
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("Cancel closes the field and puts focus back on Change it", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Wrong email? Change it" })).toHaveFocus());
    expect(changeOrderEmail).not.toHaveBeenCalled();
  });

  it("Escape cancels too, from the field or its buttons, and puts focus back on Change it", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    const field = screen.getByLabelText("New email for your tickets");
    await waitFor(() => expect(field).toHaveFocus());
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Wrong email? Change it" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Send tickets here" }), { key: "Escape" });
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Wrong email? Change it" })).toHaveFocus());
    expect(changeOrderEmail).not.toHaveBeenCalled();
  });

  it("focus still moves when Change it or Cancel is pressed before the page's last render has run its effects", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    // The press lands after a render of the page is on screen but before React has run that render's effects (a
    // busy phone, a slow CI worker): React runs those first, then renders the press. Here the press comes from a
    // layout effect, which runs at exactly that point.
    function PressOnCommit({ press }: { press: string | null }) {
      useLayoutEffect(() => {
        if (press) screen.getByRole("button", { name: press }).click();
      }, [press]);
      return <CheckoutConfirmation />;
    }
    const { rerender } = render(<PressOnCommit press={null} />);
    await screen.findByRole("button", { name: "Wrong email? Change it" });
    rerender(<PressOnCommit press="Wrong email? Change it" />);
    const field = screen.getByLabelText("New email for your tickets");
    await waitFor(() => expect(field).toHaveFocus());
    rerender(<PressOnCommit press="Cancel" />);
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Wrong email? Change it" })).toHaveFocus());
  });

  it("a refused address: the error on the field, and the server's suggestion one press away", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    changeOrderEmail.mockRejectedValueOnce(
      new ApiError(400, "That email address looks mistyped. Check the part after the @.", { email: "That email address looks mistyped. Check the part after the @." }, {
        code: "email_typo",
        suggestion: "mia@hotmail.com",
      }),
    );
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    const field = screen.getByLabelText("New email for your tickets");
    fireEvent.change(field, { target: { value: "mia@hotmial.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email address looks mistyped.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("mia@hotmail.com").closest("p")).toHaveTextContent("Did you mean mia@hotmail.com?");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(field).toHaveValue("mia@hotmail.com");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an address with an account: 'contact support', said on the field", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    changeOrderEmail.mockRejectedValueOnce(
      new ApiError(409, "Contact support@sheltuh.com.au to use this address.", undefined, { code: "email_has_account" }),
    );
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    const field = screen.getByLabelText("New email for your tickets");
    fireEvent.change(field, { target: { value: "jo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Contact support@sheltuh.com.au to use this address.");
    // Support's address is a link.
    expect(within(alert).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(field).toHaveAccessibleDescription(/Contact support@sheltuh\.com\.au to use this address\./);
  });

  it("blocked meanwhile (409 event_ended): the field closes, the status says why (once), and the token is forgotten", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    changeOrderEmail.mockRejectedValueOnce(new ApiError(409, "This event has ended…", undefined, { code: "event_ended" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "jo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const status = await screen.findByRole("status");
    await waitFor(() =>
      expect(status).toHaveTextContent("This event has ended. To change the email, contact support@sheltuh.com.au."),
    );
    expect(screen.getAllByText(/This event has ended/)).toHaveLength(1);
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("group", { name: "Ticket email" })).toHaveFocus());
    expect(orderAccessFor("cs_test_1")).toBeUndefined();
  });

  it("a token the server doesn't accept (404): only support can help", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    changeOrderEmail.mockRejectedValueOnce(new ApiError(404, "Order not found."));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "jo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("We couldn’t change it from here. Contact support@sheltuh.com.au."));
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
  });

  it.each([
    ["email_already_changed", /You’ve already changed this email once\. To change it again, contact support@sheltuh\.com\.au\./, true],
    ["ticket_scanned", /A ticket has been scanned\. To change the email, contact support@sheltuh\.com\.au\./, false],
  ] as const)("blocked (%s): the full email, why, and support's address; no Change it", async (reason, words, keepsToken) => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue({ ...PAYING, emailChange: { allowed: false, reason } });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText(paragraph(words))).toBeInTheDocument();
    expect(screen.getByText("mia@gmail.con")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    // A scan is final: this device stops keeping the token. The buyer's used change isn't (support may still help).
    expect(orderAccessFor("cs_test_1")).toBe(keepsToken ? TOKEN : undefined);
  });

  it("after the event (the server sends the masked address only): why, and support's address; the token is forgotten", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue({ ...ORDER, emailChange: { allowed: false, reason: "event_ended" } });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("Tickets sent to m***@example.com.")).toBeInTheDocument();
    expect(screen.getByText(paragraph(/^This event has ended\. To change the email, contact support@sheltuh\.com\.au\.$/))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    expect(orderAccessFor("cs_test_1")).toBeUndefined();
  });

  it("changed by support: no address at all, just how to change it again; the token is forgotten", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue({ ...ORDER, maskedEmail: undefined, emailChange: { allowed: false, reason: "changed_by_support" } });
    render(<CheckoutConfirmation />);
    const words = await screen.findByText(
      paragraph(/^Support has updated the email for this order\. To change it, contact support@sheltuh\.com\.au\.$/),
    );
    expect(within(words).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(screen.queryByText(/Tickets sent to/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    expect(orderAccessFor("cs_test_1")).toBeUndefined();
  });

  it("once sent, Cancel and Escape do nothing until the answer; after a failure both work again", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    let fail!: (err: unknown) => void;
    changeOrderEmail.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    const field = screen.getByLabelText("New email for your tickets");
    fireEvent.change(field, { target: { value: "mia@gmail.com" } });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    await waitFor(() => expect(changeOrderEmail).toHaveBeenCalledTimes(1));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByLabelText("New email for your tickets")).toBeInTheDocument();
    // A second Enter while it's being sent doesn't send it again.
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(changeOrderEmail).toHaveBeenCalledTimes(1);

    await act(async () => fail(new TypeError("Failed to fetch")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t change the email. Try again.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.keyDown(screen.getByLabelText("New email for your tickets"), { key: "Escape" });
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
  });

  it("a refusal of the address that arrives after the buyer has typed another isn't put on the new one", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValue(PAYING);
    let refuse!: (err: unknown) => void;
    changeOrderEmail.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    const field = screen.getByLabelText("New email for your tickets");
    fireEvent.change(field, { target: { value: "mia@hotmial.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    await waitFor(() => expect(changeOrderEmail).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: "alex@example.com" } });
    const message = "That email address looks mistyped. Check the part after the @.";
    await act(async () => refuse(new ApiError(400, message, { email: message }, { code: "email_typo", suggestion: "mia@hotmail.com" })));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveValue("alex@example.com");
  });

  it("already changed (an earlier try went through, its answer lost): reads the order again and shows where the tickets went", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValueOnce(PAYING).mockResolvedValueOnce({
      ...PAYING,
      email: "mia@gmail.com",
      emailChange: { allowed: false, reason: "email_already_changed" },
    });
    changeOrderEmail.mockRejectedValueOnce(new ApiError(409, "This order's email has already been changed once.", undefined, { code: "email_already_changed" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/You’ve already changed this email once/));
    // A read, never another change.
    expect(getOrderBySession).toHaveBeenLastCalledWith("cs_test_1", TOKEN);
    expect(changeOrderEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByText((_c, el) => el?.tagName === "P" && el.textContent === "Tickets sent to mia@gmail.com.")).toBeInTheDocument();
    expect(orderAccessFor("cs_test_1")).toBe(TOKEN);
  });

  it("refunded while the change was being sent (409 order_not_paid): the refund's page, not the void tickets", async () => {
    asPayingBrowser();
    getOrderBySession
      .mockResolvedValueOnce(PAYING)
      .mockResolvedValueOnce({ ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] });
    changeOrderEmail.mockRejectedValueOnce(new ApiError(409, "This order isn't paid…", undefined, { code: "order_not_paid" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    expect(await screen.findByRole("heading", { level: 1, name: "This order has been refunded" })).toBeInTheDocument();
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("another order in the same tab: a fresh form, and a late answer for the first order isn't shown on the second", async () => {
    asPayingBrowser();
    rememberOrderAccess("cs_test_2", "cd".repeat(32));
    const SECOND: CustomerOrder = { ...PAYING, reference: "#B0B0B0B0", eventTitle: "Second Show", email: "second@example.com" };
    getOrderBySession.mockImplementation(async (id: string) => (id === "cs_test_2" ? SECOND : PAYING));
    let answer!: (result: unknown) => void;
    changeOrderEmail.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { rerender } = render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    await waitFor(() => expect(changeOrderEmail).toHaveBeenCalledTimes(1));

    sessionParam = "cs_test_2";
    rerender(<CheckoutConfirmation />);
    expect(await screen.findByRole("heading", { level: 1, name: "Second Show" })).toBeInTheDocument();
    // The first order's form (and what was typed in it) didn't come along.
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    await act(async () =>
      answer({ result: "changed", order: { ...PAYING, email: "mia@gmail.com", emailChange: { allowed: false, reason: "email_already_changed" } } }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Second Show" })).toBeInTheDocument();
    expect(screen.getByText((_c, el) => el?.tagName === "P" && el.textContent === "Tickets sent to second@example.com.")).toBeInTheDocument();
    expect(screen.queryByText(/mia@gmail\.com/)).toBeNull();
  });

  it("moved to another order: loading (not the first order's tickets or token) until its own answer, and its hold isn't forgotten early", async () => {
    asPayingBrowser();
    rememberPendingCheckout("cs_test_2", "second-show");
    let second!: (order: CustomerOrder) => void;
    getOrderBySession.mockImplementation((id: string) => (id === "cs_test_2" ? new Promise((r) => (second = r)) : Promise.resolve(PAYING)));
    const { rerender } = render(<CheckoutConfirmation />);
    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    sessionParam = "cs_test_2";
    rerender(<CheckoutConfirmation />);
    expect(screen.getByRole("progressbar", { name: "Confirming your order" })).toBeInTheDocument();
    expect(screen.queryByText("ABC123")).toBeNull();
    expect(screen.queryByText(/Tickets sent to/)).toBeNull();
    // The second order isn't settled yet: its stored hold is kept.
    expect(sessionStorage.getItem("sheltuh:pending-checkout")).toContain("cs_test_2");
    await act(async () => second({ ...ORDER, reference: "#B0B0B0B0", eventTitle: "Second Show", tickets: [{ ticketCode: "XYZ789", ticketTypeName: "General admission", checkedInAt: null }] }));
    expect(screen.getByRole("heading", { level: 1, name: "Second Show" })).toBeInTheDocument();
    expect(sessionStorage.getItem("sheltuh:pending-checkout")).toBeNull();
  });

  it("back on an order after another: a late answer from the first visit doesn't put back what the new visit read", async () => {
    asPayingBrowser();
    let answer!: (result: unknown) => void;
    changeOrderEmail.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const SECOND: CustomerOrder = { ...ORDER, reference: "#B0B0B0B0", eventTitle: "Second Show" };
    getOrderBySession.mockImplementation(async (id: string) => (id === "cs_test_2" ? SECOND : PAYING));
    const { rerender } = render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    await waitFor(() => expect(changeOrderEmail).toHaveBeenCalledTimes(1));

    sessionParam = "cs_test_2";
    rerender(<CheckoutConfirmation />);
    expect(await screen.findByRole("heading", { level: 1, name: "Second Show" })).toBeInTheDocument();
    // Back to the first order, which has been refunded meanwhile.
    getOrderBySession.mockImplementation(async (id: string) =>
      id === "cs_test_2" ? SECOND : { ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] },
    );
    sessionParam = "cs_test_1";
    rerender(<CheckoutConfirmation />);
    expect(await screen.findByRole("heading", { level: 1, name: "This order has been refunded" })).toBeInTheDocument();
    await act(async () =>
      answer({ result: "changed", order: { ...PAYING, email: "mia@gmail.com", emailChange: { allowed: false, reason: "email_already_changed" } } }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "This order has been refunded" })).toBeInTheDocument();
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("refunded (409 order_not_paid) and the order can't be read again: its tickets go, and the page says to reload", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValueOnce(PAYING).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    changeOrderEmail.mockRejectedValueOnce(new ApiError(409, "This order isn't paid…", undefined, { code: "order_not_paid" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This order isn’t paid any more, so its tickets aren’t valid. Reload this page");
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("changed by support (409) and the order can't be read again: neither address is shown", async () => {
    asPayingBrowser();
    getOrderBySession.mockResolvedValueOnce(PAYING).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    changeOrderEmail.mockRejectedValueOnce(new ApiError(409, "Contact support…", undefined, { code: "changed_by_support" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent(/Support has updated the email for this order/));
    expect(screen.queryByText(/Tickets sent to/)).toBeNull();
    expect(document.body.textContent).not.toContain("mia@gmail.con");
    expect(orderAccessFor("cs_test_1")).toBeUndefined();
  });

  it("no clear answer (a 500), but the order now has the address sent: it says the change was made, with no second try", async () => {
    asPayingBrowser();
    getOrderBySession
      .mockResolvedValueOnce(PAYING)
      .mockResolvedValueOnce({ ...PAYING, email: "mia@gmail.com", emailChange: { allowed: false, reason: "email_already_changed" } });
    changeOrderEmail.mockRejectedValueOnce(new ApiError(500, "Something went wrong."));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Email changed. Tickets are on their way to mia@gmail.com."));
    expect(changeOrderEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no clear answer (a 500), and the read shows the order was refunded meanwhile: the page shows the refund, no retry", async () => {
    asPayingBrowser();
    getOrderBySession
      .mockResolvedValueOnce(PAYING)
      .mockResolvedValueOnce({ ...PAYING, status: "refunded", refundReason: "refunded", tickets: [] });
    changeOrderEmail.mockRejectedValueOnce(new ApiError(500, "Something went wrong."));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    fireEvent.change(screen.getByLabelText("New email for your tickets"), { target: { value: "mia@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send tickets here" }));
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(changeOrderEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("New email for your tickets")).toBeNull();
    expect(screen.queryByText("Couldn’t change the email. Try again.")).toBeNull();
  });

  it("another device (no token): the masked email and support's address, no change", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("Tickets sent to m***@example.com.")).toBeInTheDocument();
    expect(screen.getByText(/Wrong email\? Contact/)).toHaveTextContent("Wrong email? Contact support@sheltuh.com.au.");
    expect(screen.queryByRole("button", { name: "Wrong email? Change it" })).toBeNull();
    expect(getOrderBySession).toHaveBeenCalledWith("cs_test_1", undefined);
  });

  it("once the email has changed, another device sees no address, but still how to reach support", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, maskedEmail: undefined });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByText(/Tickets sent to/)).toBeNull();
    expect(screen.getByText(/Wrong email\? Contact/)).toHaveTextContent("Wrong email? Contact support@sheltuh.com.au.");
    expect(document.body.textContent).not.toMatch(/@example\.com/);
  });
});

describe("CheckoutConfirmation: sending a ticket to a friend (ticket transfers)", () => {
  const ORD = "ord_0123456789abcdef0123456789abcdef";
  const TID = "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f";
  const TOKEN = "ef".repeat(32);
  const SENDABLE: CustomerOrder = {
    ...WITH_DETAILS,
    eventListed: true,
    wallet: { apple: true, google: true },
    tickets: [
      { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: null, ticketNumber: 1, canSend: true },
      { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission", checkedInAt: null, ticketNumber: 2, canSend: true },
    ],
    transfers: { canSend: true, closesAt: "2027-03-06T07:00:00.000Z" },
  };
  const OFFERED = (canCancel: boolean, toName?: string): CustomerOrder => ({
    ...SENDABLE,
    tickets: [
      {
        ...SENDABLE.tickets[0],
        canSend: false,
        transfer: { status: "pending", expiresAt: "2027-03-01T00:00:00.000Z", canCancel, ...(toName ? { toName, transferId: TID } : {}) },
      },
      SENDABLE.tickets[1],
    ],
  });
  const SENT: CustomerOrder = {
    ...SENDABLE,
    tickets: [SENDABLE.tickets[0]],
    transferredTickets: [{ ticketNumber: 2, ticketTypeName: "General admission", holderName: "Sam Lee", acceptedAt: "2027-03-01T01:00:00.000Z", acceptedByMaskedEmail: "j***@outlook.com" }],
  };

  beforeEach(() => {
    sessionParam = ORD;
  });

  it("an offer in progress: the QR still shows, with 'Waiting for Sam to accept' and Cancel", async () => {
    getOrderBySession.mockResolvedValue(OFFERED(true, "Sam Lee"));
    render(<CheckoutConfirmation />);
    const strip = (await screen.findByText("Waiting for Sam to accept")).closest("[data-ticket-status]") as HTMLElement;
    expect(within(strip).getByRole("button", { name: "Cancel sending this ticket" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /7KQM-2HXD/ })).toBeInTheDocument();
    // Cancelling is on the strip, not Manage order's Send (it's on offer already).
    fireEvent.click(screen.getByRole("button", { name: "Manage order" }));
    expect(within(screen.getByRole("dialog", { name: "Manage order" })).queryByRole("button", { name: /Send ticket to a friend/ })).toBeNull();
  });

  it("an offer this visitor can't take back (no control): who it went to isn't shown, and there's no Cancel", async () => {
    getOrderBySession.mockResolvedValue(OFFERED(false));
    render(<CheckoutConfirmation />);
    const strip = (await screen.findByText("Waiting for them to accept")).closest("[data-ticket-status]") as HTMLElement;
    expect(within(strip).queryByRole("button")).toBeNull();
  });

  it("Cancel takes the offer back: the order as the server has it now, and a toast", async () => {
    rememberOrderAccess(ORD, TOKEN);
    getOrderBySession.mockResolvedValue(OFFERED(true, "Sam Lee"));
    cancelTicketTransfer.mockResolvedValue({ order: SENDABLE });
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    expect(cancelTicketTransfer).toHaveBeenCalledWith(ORD, TID, TOKEN, undefined);
    const toast = (await screen.findByText("Cancelled. Your QR code still works.")).closest("[data-toast]");
    expect(toast).toHaveAttribute("role", "status");
    expect(screen.queryByText("Waiting for Sam to accept")).toBeNull();
  });

  it("a cancel that's too late (409) says why and reads the order again", async () => {
    getOrderBySession.mockResolvedValueOnce(OFFERED(true, "Sam Lee")).mockResolvedValue(SENT);
    cancelTicketTransfer.mockRejectedValue(new ApiError(409, "This offer can't be cancelled now: it was accepted, declined or has expired.", undefined, { code: "transfer_not_pending" }));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    await waitFor(() => expect(getOrderBySession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("This QR code no longer works")).toBeInTheDocument();
  });

  it("a ticket sent and accepted: Latte's Transferred card, with no QR, code or wallet badges, numbered as the email", async () => {
    getOrderBySession.mockResolvedValue(SENT);
    const { container } = render(<CheckoutConfirmation />);
    const tickets = await screen.findByRole("region", { name: "Your tickets" });
    fireEvent.click(within(tickets).getByRole("button", { name: "Next ticket" }));
    expect(tickets).toHaveTextContent("Ticket 2 of 2");
    const card = container.querySelector('[data-state="transferred"]') as HTMLElement;
    expect(card).toHaveTextContent("Sent to Sam Lee · accepted 1 Mar");
    expect(card).toHaveTextContent("2 of 2");
    expect(card).toHaveTextContent("This QR code no longer works");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(screen.getByText("Accepted with j***@outlook.com, not the address you sent it to.")).toBeInTheDocument();
    // The sent ticket's code (A2B3-C4D5) is nowhere on the page; its wallet passes aren't offered.
    expect(container.innerHTML).not.toContain("A2B3-C4D5");
    expect(screen.queryByRole("link", { name: /Wallet/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Show ticket/ })).toBeNull();
  });

  it("Send from Manage order: the dialog, then the order as the server has it, the pending strip and the toast", async () => {
    rememberOrderAccess(ORD, TOKEN);
    getOrderBySession.mockResolvedValue(SENDABLE);
    sendTicket.mockResolvedValue({ transferId: TID, order: OFFERED(true, "Sam Lee") });
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage order" }));
    const manage = screen.getByRole("dialog", { name: "Manage order" });
    const row = within(manage).getByRole("button", { name: /Send ticket to a friend/ });
    expect(row).toHaveTextContent("Ticket 1 of 2. They get their own QR code; yours stops working");
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: "Send this ticket" });
    fireEvent.change(within(dialog).getByLabelText("Their name"), { target: { value: "Sam Lee" } });
    fireEvent.change(within(dialog).getByLabelText("Their email"), { target: { value: "sam@email.com" } });
    fireEvent.change(within(dialog).getByLabelText("Your name"), { target: { value: "Alex Chen" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    await waitFor(() =>
      expect(sendTicket).toHaveBeenCalledWith(ORD, { ticket: 1, name: "Sam Lee", email: "sam@email.com", senderName: "Alex Chen" }, TOKEN, undefined),
    );
    expect(await screen.findByText("Waiting for Sam to accept")).toBeInTheDocument();
    expect(screen.getByText("Sent to Sam. We’ll email you when they accept.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Send this ticket" })).toBeNull();
    expect(screen.getByText("Each code works once. To give a ticket away, send it from Manage order.")).toBeInTheDocument();
  });

  it("not this visitor's to send (sign_in): Manage order's row says whose email to sign in with, and goes there", async () => {
    getOrderBySession.mockResolvedValue({
      ...SENDABLE,
      tickets: SENDABLE.tickets.map((t) => ({ ...t, canSend: false })),
      transfers: { canSend: false, reason: "sign_in" },
    });
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage order" }));
    const row = within(screen.getByRole("dialog", { name: "Manage order" })).getByRole("button", { name: /Send ticket to a friend/ });
    expect(row).toHaveTextContent("Sign in with m***@example.com to send it");
    fireEvent.click(row);
    // The order's id waits in this tab; the sign-in's `next` carries only the ticket's number.
    expect(router.push).toHaveBeenCalledWith("/login?next=%2Fcheckout%2Fsuccess%3Fsend%3D1");
    expect(sessionStorage.getItem("sheltuh:return-order")).toBe(ORD);
    expect(screen.queryByRole("dialog", { name: "Send this ticket" })).toBeNull();
  });

  it("back from signing in (no session_id): the kept order, with ?send, and it's forgotten", async () => {
    sessionParam = "";
    extraParams.send = "2";
    sessionStorage.setItem("sheltuh:return-order", ORD);
    render(<CheckoutConfirmation />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/checkout/success?session_id=${ORD}&send=2`));
    expect(sessionStorage.getItem("sheltuh:return-order")).toBeNull();
    expect(getOrderBySession).not.toHaveBeenCalled();
  });

  it("?send=2 opens Send for ticket 2 once the order says it can be sent", async () => {
    extraParams.send = "2";
    getOrderBySession.mockResolvedValue(SENDABLE);
    sendTicket.mockResolvedValue({ transferId: TID, order: SENDABLE });
    render(<CheckoutConfirmation />);
    const dialog = await screen.findByRole("dialog", { name: "Send this ticket" });
    fireEvent.change(within(dialog).getByLabelText("Their name"), { target: { value: "Sam" } });
    fireEvent.change(within(dialog).getByLabelText("Their email"), { target: { value: "sam@email.com" } });
    fireEvent.change(within(dialog).getByLabelText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    await waitFor(() => expect(sendTicket).toHaveBeenCalledWith(ORD, expect.objectContaining({ ticket: 2 }), undefined, undefined));
  });

  it("?send=n does nothing when the ticket can't be sent", async () => {
    extraParams.send = "1";
    getOrderBySession.mockResolvedValue(OFFERED(true, "Sam Lee"));
    render(<CheckoutConfirmation />);
    await screen.findByText("Waiting for Sam to accept");
    expect(screen.queryByRole("dialog", { name: "Send this ticket" })).toBeNull();
  });

  it("a scanned ticket doesn't end the paying browser's token while it can still send the others", async () => {
    rememberOrderAccess(ORD, TOKEN);
    getOrderBySession.mockResolvedValue({ ...SENDABLE, emailChange: { allowed: false, reason: "ticket_scanned" } });
    render(<CheckoutConfirmation />);
    await screen.findByRole("heading", { level: 1 });
    expect(orderAccessFor(ORD)).toBe(TOKEN);
  });
});

describe("CheckoutConfirmation: ticket transfers, signed in and the edges", () => {
  const ORD = "ord_0123456789abcdef0123456789abcdef";
  const TID = "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f";
  const BASE: CustomerOrder = {
    ...WITH_DETAILS,
    eventListed: true,
    tickets: [
      { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: null, ticketNumber: 1, canSend: true },
      { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission", checkedInAt: null, ticketNumber: 2, canSend: true },
    ],
    transfers: { canSend: true },
  };
  const SIGN_IN_FIRST: CustomerOrder = { ...BASE, tickets: BASE.tickets.map((t) => ({ ...t, canSend: false })), transfers: { canSend: false, reason: "sign_in" } };
  const OFFERED: CustomerOrder = {
    ...BASE,
    tickets: [{ ...BASE.tickets[0], canSend: false, transfer: { transferId: TID, status: "pending", toName: "Sam Lee", expiresAt: "2027-03-01T00:00:00.000Z", canCancel: true } }, BASE.tickets[1]],
  };

  beforeEach(() => {
    sessionParam = ORD;
  });

  function renderSignedIn(overrides: Partial<AuthContextValue> = {}) {
    const getAccessToken = vi.fn<AuthContextValue["getAccessToken"]>().mockResolvedValue("buyer-token");
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-in", email: "mia@example.com", userId: "u-mia", getAccessToken, ...overrides })}>
        <CheckoutConfirmation />
      </FakeAuthProvider>,
    );
    return { getAccessToken };
  }

  it("signed in: the order is read with the account's token, and Send's name is the profile's", async () => {
    nav.account = { profile: { displayName: "Mia Tran" } };
    getOrderBySession.mockResolvedValue(BASE);
    renderSignedIn();
    fireEvent.click(await screen.findByRole("button", { name: "Manage order" }));
    expect(getOrderBySession).toHaveBeenCalledWith(ORD, undefined, expect.any(Function));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Manage order" })).getByRole("button", { name: /Send ticket to a friend/ }));
    const dialog = await screen.findByRole("dialog", { name: "Send this ticket" });
    expect(within(dialog).getByLabelText("Your name")).toHaveValue("Mia Tran");
    // A privacy link for the friend's details (the footer is behind the modal).
    expect(within(dialog).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("read before the session was back (sign_in), then signed in: read again once, and ?send=2 opens for ticket 2, shown", async () => {
    extraParams.send = "2";
    getOrderBySession.mockResolvedValueOnce(SIGN_IN_FIRST).mockResolvedValue(BASE);
    // The page shows ticket 1 first (ticket 2 isn't on screen until the link's number brings it).
    renderSignedIn();
    const dialog = await screen.findByRole("dialog", { name: "Send this ticket" });
    expect(getOrderBySession).toHaveBeenCalledTimes(2);
    expect(getOrderBySession).toHaveBeenLastCalledWith(ORD, undefined, expect.any(Function));
    // Which ticket, under the body; and the pager shows it.
    expect(dialog.querySelector("[data-send-ticket-label]")).toHaveTextContent("Ticket 2 of 2");
    expect(screen.getByRole("region", { name: "Your tickets" })).toHaveTextContent("Ticket 2 of 2");
  });

  it("signed in with another email: read again once (no loop), and Manage order offers Switch account", async () => {
    const signOut = vi.fn();
    getOrderBySession.mockResolvedValue(SIGN_IN_FIRST);
    renderSignedIn({ signOut });
    await waitFor(() => expect(getOrderBySession).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Manage order" }));
    const row = within(screen.getByRole("dialog", { name: "Manage order" })).getByRole("button", { name: /Send ticket to a friend/ });
    expect(row).toHaveTextContent("You’re signed in with another email. Switch to m***@example.com to send it");
    fireEvent.click(row);
    expect(signOut).toHaveBeenCalledWith("local");
    expect(router.push).toHaveBeenCalledWith("/login?next=%2Fcheckout%2Fsuccess%3Fsend%3D1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getOrderBySession).toHaveBeenCalledTimes(2);
  });

  it("after Cancel, focus goes to the tickets (the strip it was on is gone)", async () => {
    getOrderBySession.mockResolvedValue(OFFERED);
    cancelTicketTransfer.mockResolvedValue({ order: BASE });
    render(<CheckoutConfirmation />);
    const cancel = await screen.findByRole("button", { name: "Cancel sending this ticket" });
    cancel.focus();
    fireEvent.click(cancel);
    await screen.findByText("Cancelled. Your QR code still works.");
    await waitFor(() => expect(screen.getByRole("region", { name: "Your tickets" })).toHaveFocus());
  });

  it("a cancel that fails on the server (5xx): says so, keeps the offer, and doesn't re-read", async () => {
    getOrderBySession.mockResolvedValue(OFFERED);
    cancelTicketTransfer.mockRejectedValue(new ApiError(500, "boom"));
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t cancel it. Try again.");
    expect(screen.getByText("Waiting for Sam to accept")).toBeInTheDocument();
    expect(getOrderBySession).toHaveBeenCalledTimes(1);
  });

  it("with sending off, a cancel still shows its toast", async () => {
    // Sending off: the API leaves out `transfers` and every `canSend` (an offer already made can still be cancelled).
    const off = (order: CustomerOrder): CustomerOrder => ({
      ...order,
      transfers: undefined,
      tickets: order.tickets.map((t) => ({ ...t, canSend: undefined })),
    });
    getOrderBySession.mockResolvedValue(off(OFFERED));
    cancelTicketTransfer.mockResolvedValue({ order: off(BASE) });
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    const toast = (await screen.findByText("Cancelled. Your QR code still works.")).closest("[data-toast]");
    expect(toast).toHaveAttribute("role", "status");
  });

  it("a slow re-read doesn't put back what a newer answer changed", async () => {
    let finishReload: (order: CustomerOrder) => void = () => {};
    getOrderBySession
      .mockResolvedValueOnce(OFFERED)
      .mockImplementationOnce(() => new Promise<CustomerOrder>((resolve) => (finishReload = resolve)));
    // The first cancel fails (409: re-read, slow); the second goes through.
    cancelTicketTransfer
      .mockRejectedValueOnce(new ApiError(409, "Can't now.", undefined, { code: "transfer_not_pending" }))
      .mockResolvedValueOnce({ order: BASE });
    render(<CheckoutConfirmation />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    await waitFor(() => expect(getOrderBySession).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sending this ticket" }));
    await screen.findByText("Cancelled. Your QR code still works.");
    await act(async () => finishReload(OFFERED));
    expect(screen.queryByText("Waiting for Sam to accept")).toBeNull();
  });
});
