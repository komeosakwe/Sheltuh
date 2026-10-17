import { describe, expect, it } from "vitest";
import { issueTickets } from "@/lib/server/ticket-issuance";
import { parseTicketCode, TICKET_CODE_ALPHABET, TICKET_CODE_PATTERN, ticketQrPayload } from "@/lib/ticket-code";

describe("ticket codes", () => {
  it("every issued code matches the shared pattern and alphabet", () => {
    const tickets = issueTickets([
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 200 },
    ]);
    for (const { ticketCode } of tickets) {
      expect(ticketCode).toMatch(TICKET_CODE_PATTERN);
      expect(parseTicketCode(ticketCode)).toBe(ticketCode);
      expect(parseTicketCode(ticketQrPayload(ticketCode))).toBe(ticketCode);
    }
    // The pattern's character class is exactly the alphabet.
    const allowed = [...new Set(TICKET_CODE_ALPHABET)].sort().join("");
    const matching = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i))
      .filter((c) => TICKET_CODE_PATTERN.test(`${c.repeat(4)}-${c.repeat(4)}`))
      .sort()
      .join("");
    expect(matching).toBe(allowed);
    expect(TICKET_CODE_ALPHABET).toHaveLength(32);
  });

  it("accepts the bare and QR forms in any case, trimmed", () => {
    expect(parseTicketCode("7KQM-2HXD")).toBe("7KQM-2HXD");
    expect(parseTicketCode("SH1:7KQM-2HXD")).toBe("7KQM-2HXD");
    expect(parseTicketCode("  sh1:7kqm-2hxd \n")).toBe("7KQM-2HXD");
    expect(parseTicketCode("\t7kqm-2hxd")).toBe("7KQM-2HXD");
    expect(ticketQrPayload("7KQM-2HXD")).toBe("SH1:7KQM-2HXD");
  });

  it("refuses anything else, without throwing", () => {
    for (const raw of [
      undefined,
      null,
      42,
      {},
      "",
      "7KQM2HXD",
      "7KQM-2HX",
      "7KQM-2HXDD",
      "0KQM-2HXD", // 0, O, 1 and I aren't in the alphabet
      "OKQM-2HXD",
      "1KQM-2HXD",
      "IKQM-2HXD",
      "SH1: 7KQM-2HXD",
      "SH2:7KQM-2HXD",
      "SH1:SH1:7KQM-2HXD",
      "7KQM-2HXD extra",
      "https://example.com/7KQM-2HXD",
      `${" ".repeat(60)}7KQM-2HXD`,
    ]) {
      expect(parseTicketCode(raw)).toBeNull();
    }
  });
});
