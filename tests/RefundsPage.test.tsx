// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RefundsPage from "@/app/refunds/page";

afterEach(cleanup);

describe("/refunds — each event's refund policy", () => {
  it("says each event shows its own policy (the two kinds), and keeps the guarantees that always apply", () => {
    render(<RefundsPage />);
    const policy = screen.getByRole("heading", { name: "Each event’s refund policy" }).closest("section");
    if (!policy) throw new Error("policy section not rendered");
    expect(policy).toHaveTextContent("Every event shows its own refund policy");
    expect(policy).toHaveTextContent("no refunds for change of mind");
    expect(policy).toHaveTextContent("up to a set number of days before the event");
    expect(policy).toHaveTextContent("another site follow that site’s terms");

    const always = screen.getByRole("heading", { name: "When you’re refunded" }).closest("section");
    expect(always).toHaveTextContent("Whatever the event’s policy:");
    expect(always).toHaveTextContent("The event is cancelled.");
    expect(always).toHaveTextContent("Australian Consumer Law");
  });
});
