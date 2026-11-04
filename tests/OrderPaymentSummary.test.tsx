// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import OrderPaymentSummary from "@/components/checkout/OrderPaymentSummary";
import type { OrderPaymentSummary as Summary } from "@/lib/api/types";

afterEach(cleanup);

const SUMMARY: Summary = {
  eventTitle: "Paper Moon Ceramics Lab",
  seated: false,
  lines: [
    { ticketTypeName: "Workshop seat", quantity: 1, unitTotalCents: 6500, lineTotalCents: 6500, buyerPaysFee: false },
    { ticketTypeName: "Group of 4", quantity: 2, admits: 4, unitTotalCents: 24000, lineTotalCents: 48000, buyerPaysFee: false },
  ],
  subtotalCents: 54500,
  buyerFeeCents: 0,
  totalCents: 54500,
};

describe("OrderPaymentSummary: group tickets", () => {
  it("says how many people a group line admits, and counts tickets as people", () => {
    render(<OrderPaymentSummary summary={SUMMARY} />);
    expect(screen.getByText("2 × A$240 · Admits 4")).toBeInTheDocument();
    // A single line says nothing about it.
    expect(screen.getByText("1 × A$65")).toBeInTheDocument();
    // 1 single + 2 groups of 4.
    expect(screen.getByRole("button", { name: "Show 9 tickets" })).toBeInTheDocument();
  });
});
