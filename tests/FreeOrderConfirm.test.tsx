// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  vi.stubGlobal("location", { ...window.location, assign, hash: `#token=${TOKEN}`, pathname: "/checkout/confirm", search: "" });
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FreeOrderConfirm", () => {
  it("confirms only when the button is pressed, then goes to the tickets", async () => {
    confirmFreeOrder.mockResolvedValue({ url: "https://sheltuh.test/checkout/success?session_id=ord_1" });
    render(<FreeOrderConfirm />);
    const button = await screen.findByRole("button", { name: "Confirm" });
    // The token is read, then removed from the address bar.
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/checkout/confirm");
    expect(confirmFreeOrder).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(confirmFreeOrder).toHaveBeenCalledWith(TOKEN);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://sheltuh.test/checkout/success?session_id=ord_1"));
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
