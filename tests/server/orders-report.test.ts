import { describe, expect, it } from "vitest";
import type { EventOrderRow } from "@/lib/api/types";
import { toCsv } from "@/lib/server/csv";
import { eventOrdersCsv, orderStatusLabel, placedInZone } from "@/lib/server/orders-report";

const row = (over: Partial<EventOrderRow> = {}): EventOrderRow => ({
  reference: "#A1B2C3D4",
  placedAt: "2027-03-06T09:30:00.000Z",
  status: "paid",
  buyerName: "Dee Lee",
  buyerEmail: "dee@example.com",
  tickets: [{ ticketTypeName: "General admission", quantity: 2 }],
  paidCents: 6460,
  refundedCents: 0,
  ...over,
});

const body = (rows: EventOrderRow[]) => toCsv(eventOrdersCsv(rows, "Australia/Melbourne")).split("\r\n");

describe("eventOrdersCsv", () => {
  it("starts with a byte-order mark and a header, one quoted row per order", () => {
    const text = toCsv(eventOrdersCsv([row()], "Australia/Melbourne"));
    expect(text.startsWith("﻿")).toBe(true);
    expect(body([row()])).toEqual([
      '﻿"Reference","Placed","Name","Email","Tickets","Paid (A$)","Refunded (A$)","Status"',
      '"#A1B2C3D4","2027-03-06 20:30","Dee Lee","dee@example.com","2 × General admission","64.60","0.00","Paid"',
      "",
    ]);
  });

  it("writes the placed time in the event's zone", () => {
    expect(placedInZone("2027-03-06T09:30:00.000Z", "Australia/Melbourne")).toBe("2027-03-06 20:30");
    expect(placedInZone("2027-03-06T09:30:00.000Z", "Australia/Perth")).toBe("2027-03-06 17:30");
    expect(placedInZone("2027-03-05T13:05:00.000Z", "Australia/Sydney")).toBe("2027-03-06 00:05");
  });

  it("blank cells for an order with no details", () => {
    expect(body([row({ buyerName: null, buyerEmail: null })])[1]).toContain('"#A1B2C3D4","2027-03-06 20:30","","",');
  });

  it("labels the status as the page does", () => {
    expect(orderStatusLabel({ status: "paid", refundedCents: 0 })).toBe("Paid");
    expect(orderStatusLabel({ status: "paid", refundedCents: 500 })).toBe("Part refunded");
    expect(orderStatusLabel({ status: "refunded", refundedCents: 6460 })).toBe("Refunded");
  });

  it("defends names and emails against formula injection, quotes and commas, and keeps them whole", () => {
    const names = ['=HYPERLINK("http://x.example")', "+61 400 000 000", "-1", "@SUM(A1)", "\t=1", "\r=1", "\n=1", " =1", 'He said "hi", twice'];
    const emails = ["+plus@example.com", "-minus@example.com", "=cmd@example.com", "@at@example.com"];
    const rows = [...names.map((buyerName) => row({ buyerName })), ...emails.map((buyerEmail) => row({ buyerEmail }))];
    const lines = toCsv(eventOrdersCsv(rows, "Australia/Melbourne"));
    for (const name of names.slice(0, 4)) expect(lines).toContain(`"'${name.replace(/"/g, '""')}"`);
    // Whitespace before the formula character is defended too: the cell starts with a quote.
    expect(lines).toContain(`"'\t=1"`);
    expect(lines).toContain(`"'\r=1"`);
    expect(lines).toContain(`"'\n=1"`);
    expect(lines).toContain(`"' =1"`);
    expect(lines).toContain('"He said ""hi"", twice"');
    for (const email of emails) expect(lines).toContain(`"'${email}"`);
    // Every cell that starts with a formula character is preceded by the defending quote.
    expect(lines).not.toMatch(/(^|,)"[=+\-@\t\r]/m);
  });

  it("a ticket type name starting with a formula character is safe inside the joined cell", () => {
    expect(body([row({ tickets: [{ ticketTypeName: "=1+1", quantity: 1 }] })])[1]).toContain('"1 × =1+1"');
  });
});
