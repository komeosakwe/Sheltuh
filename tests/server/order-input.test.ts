import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/server/http";
import { parseBuyerName, parseCheckoutLineItems } from "@/lib/server/order-input";
import type { TicketTypeInput } from "@/lib/server/types";

const TICKET_TYPES: TicketTypeInput[] = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 100 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 10 },
];

describe("parseCheckoutLineItems", () => {
  it("prices, names and fee-policies every line from the event's own live ticket types — never the client", () => {
    const result = parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 2 }] }, TICKET_TYPES);
    expect(result).toEqual([
      { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 2 },
    ]);
  });

  it("ignores a client-submitted price/name/feePolicy on the line item", () => {
    const result = parseCheckoutLineItems(
      { lineItems: [{ ticketTypeId: "ga", quantity: 1, unitPriceCents: 1, feePolicy: "organiser-absorbs" }] },
      TICKET_TYPES,
    );
    expect(result[0].unitPriceCents).toBe(3000);
    expect(result[0].feePolicy).toBe("buyer-pays");
  });

  it("rejects an unknown ticket type id", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "nope", quantity: 1 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 0 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: -1 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects a non-integer quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 1.5 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects an excessive quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 999 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects an empty lineItems array", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [] }, TICKET_TYPES)).toThrow(HttpError);
  });

  it("rejects a missing lineItems field", () => {
    expect(() => parseCheckoutLineItems({}, TICKET_TYPES)).toThrow(HttpError);
  });

  it("accepts multiple distinct line items in one order", () => {
    const result = parseCheckoutLineItems(
      {
        lineItems: [
          { ticketTypeId: "ga", quantity: 2 },
          { ticketTypeId: "vip", quantity: 1 },
        ],
      },
      TICKET_TYPES,
    );
    expect(result).toHaveLength(2);
    expect(result[1].ticketTypeId).toBe("vip");
  });

  it("rejects the same ticket type on two lines, so quantities can't be split to dodge the limits", () => {
    const body = { lineItems: [{ ticketTypeId: "ga", quantity: 15 }, { ticketTypeId: "ga", quantity: 15 }] };
    try {
      parseCheckoutLineItems(body, TICKET_TYPES);
      throw new Error("expected a validation error");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).fieldErrors).toEqual({
        "lineItems[1].ticketTypeId": "Each ticket type can only appear once per order.",
      });
    }
  });
});

describe("parseBuyerName", () => {
  const fieldError = (value: unknown) => {
    try {
      parseBuyerName(value);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      return (err as HttpError).fieldErrors?.buyerName;
    }
    throw new Error(`expected ${JSON.stringify(value)} to be refused`);
  };

  it("absent, null and empty are no name", () => {
    expect(parseBuyerName(undefined)).toBeNull();
    expect(parseBuyerName(null)).toBeNull();
    expect(parseBuyerName("")).toBeNull();
  });

  it("cleans: NFC, spaces collapsed (non-breaking ones too), trimmed", () => {
    expect(parseBuyerName("  Zoë   Smith ")).toBe("Zoë Smith");
    expect(parseBuyerName("Zoë Smith")).toBe("Zoë Smith");
    expect(parseBuyerName("Nguyễn Văn An")).toBe("Nguyễn Văn An");
    expect(parseBuyerName("李小龍")).toBe("李小龍");
    expect(parseBuyerName("Mr. Me")).toBe("Mr. Me");
    expect(parseBuyerName("O'Brien-Smith")).toBe("O'Brien-Smith");
  });

  it("counts code points: 80 pass, 81 don't (an emoji is one)", () => {
    expect(parseBuyerName("a".repeat(80))).toBe("a".repeat(80));
    expect(parseBuyerName("😀".repeat(79) + "a")).toHaveLength(79 * 2 + 1);
    expect(fieldError("a".repeat(81))).toMatch(/80 characters or fewer/);
    expect(fieldError("😀".repeat(80) + "a")).toMatch(/80 characters or fewer/);
  });

  it("refuses whitespace only, non-strings, and names with no letter or number", () => {
    expect(fieldError("   ")).toBe("Enter your name.");
    expect(fieldError(" 　")).toBe("Enter your name.");
    expect(fieldError(42)).toBe("Enter your name.");
    expect(fieldError({ first: "A" })).toBe("Enter your name.");
    expect(fieldError("---")).toMatch(/letter or number/);
    expect(fieldError("😀")).toMatch(/letter or number/);
  });

  describe("zero-width joiners", () => {
    // Built from code points so no invisible character is typed into this file.
    const ZWNJ = String.fromCodePoint(0x200c);
    const ZWJ = String.fromCodePoint(0x200d);
    const PERSIAN = (joiner: string) => `${String.fromCodePoint(0x645, 0x6cc)}${joiner}${String.fromCodePoint(0x62e, 0x648, 0x627, 0x647, 0x645)}`;
    const DEVANAGARI = (joiner: string) => `${String.fromCodePoint(0x915, 0x94d)}${joiner}${String.fromCodePoint(0x937)}`;

    it("are kept between two letters (Persian) and after a virama before a letter (Indic)", () => {
      expect(parseBuyerName(PERSIAN(ZWNJ))).toBe(PERSIAN(ZWNJ));
      expect(parseBuyerName(DEVANAGARI(ZWJ))).toBe(DEVANAGARI(ZWJ));
      expect(parseBuyerName(`Ana ${PERSIAN(ZWNJ)}`)).toBe(`Ana ${PERSIAN(ZWNJ)}`);
      expect(parseBuyerName(`a${ZWJ}b`)).toBe(`a${ZWJ}b`);
    });

    it("are refused anywhere else: leading, trailing, doubled, by a space, a digit or a symbol", () => {
      const bad = [
        `${ZWNJ}Ana`,
        `Ana${ZWNJ}`,
        `Ana${ZWJ}`,
        `a${ZWNJ}${ZWNJ}b`,
        `a${ZWNJ}${ZWJ}b`,
        `a ${ZWNJ}b`,
        `a${ZWNJ} b`,
        `a${ZWJ}1`,
        `1${ZWJ}a`,
        `a${ZWNJ}-b`,
        `${ZWJ}`,
      ];
      for (const value of bad) expect(fieldError(value), JSON.stringify(value)).toMatch(/invisible or control/);
    });

    it("don't make other invisible characters pass", () => {
      const ZWSP = String.fromCodePoint(0x200b);
      expect(fieldError(`a${ZWNJ}${ZWSP}b`)).toMatch(/invisible or control/);
      expect(fieldError(`a${ZWSP}${ZWNJ}b`)).toMatch(/invisible or control/);
    });
  });

  it("refuses control, invisible and bidi characters", () => {
    for (const bad of ["A\nB", "A\tB", "A\u0000B", "A​B", "A‮B", "A B", "A﻿B", "A­B", "AㅤB", "A⠀B"]) {
      expect(fieldError(bad), JSON.stringify(bad)).toMatch(/invisible or control/);
    }
  });

  it("refuses stacked combining marks", () => {
    expect(fieldError(`Z${"́".repeat(6)}alo`)).toMatch(/stack accents/);
  });

  it("refuses an @ and links: a name isn't contact details", () => {
    for (const bad of ["a@b.co", "@handle", "＠handle", "https://x.example", "www.example.com", "Buy at x.com", "cheap tix [dot] com"]) {
      expect(fieldError(bad), bad).toMatch(/links, email addresses or @handles/);
    }
  });
});
