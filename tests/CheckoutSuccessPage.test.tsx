// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutSuccessPage from "@/app/checkout/success/page";
import { sampleTicketOrder } from "@/lib/sample-order";

// The demo: no API (whatever this machine's env says). The live page's own behaviour: tests/CheckoutConfirmation.test.tsx.
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), isApiConfigured: false }));
// The live page, which the demo must never render (it would look the order up).
vi.mock("@/components/CheckoutConfirmation", () => ({ default: () => <p>live order lookup</p> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/checkout/success in the demo (no API)", () => {
  it("shows the sample ticket (DemoTicket), not the live order lookup, and asks the network for nothing", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const sample = sampleTicketOrder();
    if (!sample) throw new Error("the samples have no ticketed event");
    render(<CheckoutSuccessPage />);
    expect(screen.getByRole("heading", { level: 1, name: sample.event.title })).toBeInTheDocument();
    expect(screen.getByText("Order #DEMO0001 Confirmed")).toBeInTheDocument();
    expect(screen.queryByText("live order lookup")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
