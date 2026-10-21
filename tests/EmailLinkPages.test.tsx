// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FollowUnsubscribe from "@/components/following/FollowUnsubscribe";
import WaitlistConfirm from "@/components/waitlist/WaitlistConfirm";
import WaitlistLeave from "@/components/waitlist/WaitlistLeave";
import { ApiError } from "@/lib/api/client";

const confirmWaitlist = vi.fn();
const leaveWaitlist = vi.fn();
const unsubscribeFromFollowEmails = vi.fn();
vi.mock("@/lib/api/waitlist", () => ({
  confirmWaitlist: (...args: unknown[]) => confirmWaitlist(...args),
  leaveWaitlist: (...args: unknown[]) => leaveWaitlist(...args),
}));
vi.mock("@/lib/api/follows", () => ({
  unsubscribeFromFollowEmails: (...args: unknown[]) => unsubscribeFromFollowEmails(...args),
}));

const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

const TOKEN = "Z".repeat(40) + "a_-";

function at(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  api.configured = true;
  confirmWaitlist.mockReset();
  leaveWaitlist.mockReset();
  unsubscribeFromFollowEmails.mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("/waitlist/confirm", () => {
  it("does nothing until Confirm is pressed, clears the token from the URL, then links to the tickets", async () => {
    at(`/waitlist/confirm#token=${TOKEN}`);
    confirmWaitlist.mockResolvedValue({
      status: "joined",
      eventTitle: "Off-Kilter",
      eventSlug: "off-kilter",
      ticketsAvailable: false,
    });
    render(
      <StrictMode>
        <WaitlistConfirm />
      </StrictMode>,
    );
    const button = await screen.findByRole("button", { name: "Confirm" });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/waitlist/confirm");
    expect(confirmWaitlist).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(confirmWaitlist).toHaveBeenCalledWith(TOKEN);
    const heading = await screen.findByRole("heading", { name: "You’re on the waitlist" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/For Off-Kilter\. We’ll email you if tickets come up/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/off-kilter#tickets");
  });

  it("says when tickets are on sale again, with Get tickets", async () => {
    at(`/waitlist/confirm#token=${TOKEN}`);
    confirmWaitlist.mockResolvedValue({ status: "joined", eventTitle: "X", eventSlug: "x", ticketsAvailable: true });
    render(<WaitlistConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("link", { name: "Get tickets" })).toHaveAttribute("href", "/events/x#tickets");
  });

  it("an incomplete link says so (focused), with no button", async () => {
    at("/waitlist/confirm#token=short");
    render(<WaitlistConfirm />);
    const heading = await screen.findByRole("heading", { name: "This link is incomplete" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it.each([
    [new ApiError(410, "This link has expired. Join the waitlist again from the event page."), "This link has expired", false],
    [new ApiError(404, "nope"), "This link isn’t valid", false],
    [new ApiError(409, "The waitlist for this event is closed."), "The waitlist is closed", false],
    [new ApiError(500, "boom"), "Something went wrong", true],
  ])("explains %s", async (err, title, retry) => {
    at(`/waitlist/confirm#token=${TOKEN}`);
    confirmWaitlist.mockRejectedValue(err);
    render(<WaitlistConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    const heading = await screen.findByRole("heading", { name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(retry);
  });
});

describe("/waitlist/leave", () => {
  it("leaves only on the button, and names the event", async () => {
    at(`/waitlist/leave#token=${TOKEN}`);
    leaveWaitlist.mockResolvedValue({ status: "left", eventTitle: "Off-Kilter" });
    render(<WaitlistLeave />);
    const button = await screen.findByRole("button", { name: "Leave the waitlist" });
    expect(leaveWaitlist).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    fireEvent.click(button);
    expect(leaveWaitlist).toHaveBeenCalledWith({ token: TOKEN });
    const heading = await screen.findByRole("heading", { name: "You’ve left the waitlist" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/We won’t email you about Off-Kilter again/)).toBeInTheDocument();
  });

  it("announces the work while it runs (busy, focus kept)", async () => {
    at(`/waitlist/leave#token=${TOKEN}`);
    leaveWaitlist.mockReturnValue(new Promise(() => {}));
    render(<WaitlistLeave />);
    const button = await screen.findByRole("button", { name: "Leave the waitlist" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Leaving…" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Leaving the waitlist…");
  });
});

describe("/following/unsubscribe", () => {
  it("unsubscribes on the button, keeps the follow, and links to the follows page", async () => {
    at(`/following/unsubscribe#token=${TOKEN}`);
    unsubscribeFromFollowEmails.mockResolvedValue({ status: "unsubscribed", organiserName: "Static Collective" });
    render(<FollowUnsubscribe />);
    const button = await screen.findByRole("button", { name: "Unsubscribe" });
    expect(unsubscribeFromFollowEmails).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/following/unsubscribe");
    fireEvent.click(button);
    expect(unsubscribeFromFollowEmails).toHaveBeenCalledWith(TOKEN);
    await screen.findByRole("heading", { name: "You’re unsubscribed" });
    expect(screen.getByText(/new events from Static Collective\. You still follow them/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organisers you follow" })).toHaveAttribute("href", "/following");
  });

  it("an unknown link is invalid", async () => {
    at(`/following/unsubscribe#token=${TOKEN}`);
    unsubscribeFromFollowEmails.mockRejectedValue(new ApiError(404, "nope"));
    render(<FollowUnsubscribe />);
    fireEvent.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("heading", { name: "This link isn’t valid" })).toBeInTheDocument();
  });
});

describe("email link pages in demo mode (no live service)", () => {
  it("say it's a demo, change nothing, and never show an error", () => {
    api.configured = false;
    at(`/following/unsubscribe#token=${TOKEN}`);
    render(<FollowUnsubscribe />);
    expect(screen.getByRole("heading", { level: 1, name: "Stop new-event emails" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Email links work on the live site. Nothing was changed in this demo.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(unsubscribeFromFollowEmails).not.toHaveBeenCalled();
  });
});
