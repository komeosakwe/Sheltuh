// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExternalGoing from "@/components/ExternalGoing";
import { ApiError } from "@/lib/api/client";
import { demoGoing } from "@/lib/event-card";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let configured = true;
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return {
    ...actual,
    get isApiConfigured() {
      return configured;
    },
  };
});

const api = { summary: vi.fn(), mine: vi.fn(), set: vi.fn(), unset: vi.fn() };
vi.mock("@/lib/api/going", () => ({
  getExternalGoingSummary: (...a: unknown[]) => api.summary(...a),
  getMyExternalGoing: (...a: unknown[]) => api.mine(...a),
  setExternalGoing: (...a: unknown[]) => api.set(...a),
  unsetExternalGoing: (...a: unknown[]) => api.unset(...a),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  configured = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  for (const fn of Object.values(api)) fn.mockReset();
});

const EVENT = {
  id: "evt-1",
  slug: "dub-session",
  organiserId: "org-1",
  startsAt: "2026-11-07T08:30:00.000Z",
  endsAt: "2026-11-07T13:00:00.000Z",
};
const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined });
const summary = (count: number) => {
  const countHidden = count < 3;
  return { count: countHidden ? 0 : count, closed: false, countHidden };
};

function renderGoing(auth = fakeAuthValue(), event: typeof EVENT = EVENT) {
  return render(
    <FakeAuthProvider value={auth}>
      <ExternalGoing event={event} />
    </FakeAuthProvider>,
  );
}

describe("ExternalGoing (live)", () => {
  it("shows the count only from three, for a signed-out visitor, with a sign-in link back to the event", async () => {
    api.summary.mockResolvedValue(summary(12));
    renderGoing(signedOut());
    expect(await screen.findByText("12 going")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who's going" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "I’m going" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fevents%2Fdub-session");
    expect(api.mine).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])("withholds a count of %i: just the button", async (n) => {
    api.summary.mockResolvedValue(summary(n));
    renderGoing(signedOut());
    await screen.findByRole("link", { name: "I’m going" });
    expect(screen.queryByText(/^\d+ going/)).toBeNull();
  });

  it("shows nothing when the event is closed or the load fails", async () => {
    api.summary.mockResolvedValue({ count: 0, closed: true, countHidden: false });
    const { container, unmount } = renderGoing(signedOut());
    await waitFor(() => expect(api.summary).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    unmount();
    api.summary.mockRejectedValue(new ApiError(500, "no"));
    const second = renderGoing(signedOut());
    await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(second.container).toBeEmptyDOMElement();
  });

  it("toggles: I'm going, Going ✓, and back, moving the count", async () => {
    api.summary.mockResolvedValue(summary(5));
    api.mine.mockResolvedValue({ going: false, open: true });
    api.set.mockResolvedValue({ going: true, open: true });
    api.unset.mockResolvedValue({ going: false, open: true });
    renderGoing();
    const button = await screen.findByRole("button", { name: "I’m going" });
    expect(screen.getByText("5 going")).toBeInTheDocument();

    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Going ✓" })).toBeInTheDocument();
    expect(api.set).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(screen.getByText("6 going")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Going ✓" }));
    expect(await screen.findByRole("button", { name: "I’m going" })).toBeInTheDocument();
    expect(api.unset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("5 going")).toBeInTheDocument();
  });

  it("shows the member's own state below the threshold without revealing a number", async () => {
    api.summary.mockResolvedValue(summary(1));
    api.mine.mockResolvedValue({ going: true, open: true });
    renderGoing();
    expect(await screen.findByRole("button", { name: "Going ✓" })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ going/)).toBeNull();
  });

  it("explains a refusal (unverified email) and stays not going", async () => {
    api.summary.mockResolvedValue(summary(5));
    api.mine.mockResolvedValue({ going: false, open: true });
    api.set.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderGoing();
    fireEvent.click(await screen.findByRole("button", { name: "I’m going" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email address first.");
    expect(screen.getByRole("button", { name: "I’m going" })).toBeInTheDocument();
    expect(screen.getByText("5 going")).toBeInTheDocument();
  });
});

describe("ExternalGoing (demo)", () => {
  it("shows a labelled sample count and a disabled button, and never calls the API", () => {
    configured = false;
    const { count } = demoGoing(EVENT.id);
    renderGoing(signedOut());
    expect(screen.getByText(`${count} going (sample)`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I’m going" })).toBeDisabled();
    expect(screen.getByText("Sample count.")).toBeInTheDocument();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("shows nothing once the event has ended", () => {
    configured = false;
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const { container } = renderGoing(signedOut());
    expect(container).toBeEmptyDOMElement();
  });
});
