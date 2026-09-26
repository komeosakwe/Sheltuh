import { describe, expect, it } from "vitest";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";

const event = {
  title: "Paint & <Sip>",
  venueName: "Studio 5",
  venueAddress: "5 Smith St, Fitzroy",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T11:00:00.000Z",
} as EventRecord;

const order = {
  orderId: "ord_abc",
  buyerEmail: "fan@example.com",
  totalCents: 6400,
  tickets: [
    { ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" },
    { ticketCode: "JKLM-NPQR", ticketTypeId: "ga", ticketTypeName: "GA" },
  ],
} as OrderRecord;

describe("buildTicketEmail", () => {
  it("lists every ticket code, the Melbourne time, the venue and a link back to the order", () => {
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(email.to).toBe("fan@example.com");
    expect(email.subject).toBe("Your tickets: Paint & <Sip>");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("ABCD-EFGH");
      expect(body).toContain("JKLM-NPQR");
      expect(body).toContain("8:00 pm"); // 9am UTC is 8pm AEDT
      expect(body).toContain("https://sheltuh.com.au/checkout/success?session_id=ord_abc");
    }
    expect(email.text).toContain("A$64 (incl. booking fees)");
  });

  it("escapes organiser-supplied text in the HTML version", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(html).not.toContain("<Sip>");
    expect(html).toContain("&#60;Sip&#62;");
  });

  it("says Free for a free order", () => {
    expect(buildTicketEmail({ ...order, totalCents: 0 }, event, "https://x").text).toContain("Total: Free");
  });
});
