// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketStub from "@/components/tickets/TicketStub";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HINT = "Turn your brightness up at the door.";

describe("TicketStub", () => {
  // The Code 128 strip (LinearBarcode, aria-hidden) was replaced by the QR
  // (docs/design/check-in.md §5.B2), so the stub now has one decorative SVG
  // (the ü brand mark) and one named QR image, not two hidden SVGs.
  it("shows the ticket type, a named QR image, the code as text under it, and the ü as hidden decoration", () => {
    const { container } = render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="General admission" />
      </ul>,
    );
    expect(screen.getByText("General admission")).toBeInTheDocument();
    const qr = screen.getByRole("img", { name: "QR code for ticket K7M2-QW3R" });
    const code = screen.getByText("K7M2-QW3R");
    // The text code follows the QR in reading order.
    expect(qr.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(HINT)).toHaveClass("print:hidden");

    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs).toHaveLength(2);
    const hidden = svgs.filter((svg) => svg.getAttribute("aria-hidden") === "true");
    expect(hidden).toHaveLength(1);
    expect(hidden[0].querySelectorAll("polygon").length).toBeGreaterThan(0); // the ü, not the QR
    expect(container.querySelector("li")).toHaveClass("print:break-inside-avoid");
  });

  it("falls back to the text code alone, with no QR or brightness hint, for a code that isn't a real one", () => {
    const { container } = render(
      <ul>
        <TicketStub code="ABC123" typeName="General admission" />
      </ul>,
    );
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1); // the ü only
  });

  it("numbers the ticket within a multi-ticket order, and not in a single-ticket one", () => {
    const { unmount } = render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="General admission" ticketNumber={2} ticketCount={3} />
      </ul>,
    );
    expect(screen.getByText("Ticket 2 of 3 · General admission")).toBeInTheDocument();
    unmount();

    render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="General admission" ticketNumber={1} ticketCount={1} />
      </ul>,
    );
    expect(screen.getByText("General admission")).toBeInTheDocument();
    expect(screen.queryByText(/Ticket 1 of 1/)).toBeNull();
  });

  it("gives different tickets different U-shaped barcodes", () => {
    const shape = (code: string) => {
      const { container, unmount } = render(
        <ul>
          <TicketStub code={code} typeName="GA" />
        </ul>,
      );
      const polys = Array.from(container.querySelectorAll("polygon")).map((p) => p.getAttribute("points"));
      unmount();
      return polys.join("|");
    };
    expect(shape("K7M2-QW3R")).not.toEqual(shape("A2B3-C4D5"));
  });

  it("shows the event's name, when and where on each ticket, and labels the code as the backup", () => {
    render(
      <ul>
        <TicketStub
          code="K7M2-QW3R"
          typeName="VIP"
          eventTitle="Neon Static"
          when="Sat 6 Mar, 8:00 pm – 11:30 pm"
          where="The Tote, Collingwood"
          checkedInAt={null}
        />
      </ul>,
    );
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText("Neon Static")).toBeInTheDocument();
    expect(screen.getByText("Sat 6 Mar, 8:00 pm – 11:30 pm")).toBeInTheDocument();
    expect(screen.getByText("The Tote, Collingwood")).toBeInTheDocument();
    const label = screen.getByText("Backup code");
    const code = screen.getByText("K7M2-QW3R");
    expect(label.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Ready to scan")).toBeInTheDocument();
  });

  it("says when a ticket was checked in (Melbourne time), keeps its QR and code, and drops the brightness hint", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-06T11:00:00.000Z")); // 10:00 pm Sat, Melbourne
    render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="GA" checkedInAt="2027-03-06T09:42:00.000Z" />
      </ul>,
    );
    expect(screen.getByText("Checked in 8:42 pm")).toBeInTheDocument();
    expect(screen.queryByText("Ready to scan")).toBeNull();
    expect(screen.getByRole("img", { name: "QR code for ticket K7M2-QW3R" })).toBeInTheDocument();
    expect(screen.getByText("K7M2-QW3R")).toBeInTheDocument();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("names the day of a check-in on an earlier day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-08T01:00:00.000Z"));
    render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="GA" checkedInAt="2027-03-06T09:42:00.000Z" />
      </ul>,
    );
    expect(screen.getByText("Checked in Sat 6 Mar, 8:42 pm")).toBeInTheDocument();
  });

  it("an old-style code with no QR is an entry code, ready to use", () => {
    render(
      <ul>
        <TicketStub code="ABC123" typeName="GA" />
      </ul>,
    );
    expect(screen.getByText("Entry code")).toBeInTheDocument();
    expect(screen.queryByText("Backup code")).toBeNull();
    expect(screen.getByText("Ready to use")).toBeInTheDocument();
  });

  it("without event details (an older API), shows the ticket alone", () => {
    const { container } = render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="General admission" />
      </ul>,
    );
    expect(container.querySelectorAll("li p")).toHaveLength(5); // type, backup label, code, status, hint
    expect(screen.getByText("Ready to scan")).toBeInTheDocument();
  });
});
