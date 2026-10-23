// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FreeOrderConfirm from "@/components/FreeOrderConfirm";
import { ApiError } from "@/lib/api/client";

const confirmFreeOrder = vi.fn();
vi.mock("@/lib/api/orders", () => ({
  confirmFreeOrder: (...args: unknown[]) => confirmFreeOrder(...args),
}));

const TOKEN = "A".repeat(40) + "b_-";
const assign = vi.fn();

beforeEach(() => {
  confirmFreeOrder.mockReset();
  assign.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FreeOrderConfirm (real URL, StrictMode)", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("reads the token once, even though StrictMode runs the effect twice, and clears it from the URL", async () => {
    // No stubs: jsdom's own location and history, as in `next dev` and e2e.
    window.history.replaceState(null, "", `/checkout/confirm?from=email#token=${TOKEN}`);
    expect(window.location.hash).toBe(`#token=${TOKEN}`);
    render(
      <StrictMode>
        <FreeOrderConfirm />
      </StrictMode>,
    );
    expect(await screen.findByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This link is incomplete" })).toBeNull();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/checkout/confirm?from=email");
  });
});

describe("FreeOrderConfirm", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { ...window.location, assign, hash: `#token=${TOKEN}`, pathname: "/checkout/confirm", search: "" });
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  it("confirms only when the button is pressed, then goes to the tickets", async () => {
    confirmFreeOrder.mockResolvedValue({ url: "https://sheltuh.test/checkout/success?session_id=ord_1" });
    render(<FreeOrderConfirm />);
    // Loading is announced politely until the token has been read.
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    const button = await screen.findByRole("button", { name: "Confirm" });
    // The token is read, then removed from the address bar.
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/checkout/confirm");
    expect(confirmFreeOrder).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(confirmFreeOrder).toHaveBeenCalledWith(TOKEN);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://sheltuh.test/checkout/success?session_id=ord_1"));
  });

  it("a seated booking whose seats went first: names them and offers choosing again (docs/design/seating.md §5.11)", async () => {
    confirmFreeOrder.mockRejectedValue(
      new ApiError(409, "Those seats have gone.", undefined, {
        code: "seats_taken",
        seats: [
          { section: "Stalls", row: "F", seat: "12", kind: "standard" },
          { section: "Stalls", row: "F", seat: "2", kind: "standard" },
        ],
        eventSlug: "off-kilter",
      }),
    );
    render(<FreeOrderConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    const heading = await screen.findByRole("heading", { name: "Those seats have gone" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAccessibleDescription(
      "Some of your seats were booked by someone else before you confirmed: Stalls · Row F · Seat 2, Stalls · Row F · Seat 12. Nothing was booked.",
    );
    expect(screen.getByRole("link", { name: "Choose seats again" })).toHaveAttribute("href", "/events/off-kilter/seats");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says when the link is incomplete", async () => {
    vi.stubGlobal("location", { ...window.location, assign, hash: "#token=short", pathname: "/checkout/confirm", search: "" });
    render(<FreeOrderConfirm />);
    const heading = await screen.findByRole("heading", { name: "This link is incomplete" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it.each([
    [new ApiError(410, "expired"), "This link has expired"],
    [new ApiError(404, "nope"), "This link isn’t valid"],
    [new ApiError(409, "Those tickets just ran out."), "We couldn’t issue these tickets"],
  ])("explains a refusal (%s)", async (err, title) => {
    confirmFreeOrder.mockRejectedValue(err);
    render(<FreeOrderConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    const heading = await screen.findByRole("heading", { name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // Focus on the heading reads the explanation with it; no second, competing alert.
    expect(heading.getAttribute("aria-describedby")).toBeTruthy();
    expect(heading).toHaveAccessibleDescription(/\S/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the server's own wording for an expired link", async () => {
    confirmFreeOrder.mockRejectedValue(new ApiError(410, "This link has expired. Your tickets were emailed to you when you confirmed it."));
    render(<FreeOrderConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/tickets were emailed to you when you confirmed it/)).toBeInTheDocument();
  });

  it("offers a retry after a network error", async () => {
    confirmFreeOrder.mockRejectedValueOnce(new ApiError(0, "offline")).mockResolvedValueOnce({ url: "/checkout/success?session_id=x" });
    render(<FreeOrderConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(confirmFreeOrder).toHaveBeenCalledTimes(2);
  });
});
