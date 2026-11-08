// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NearMeButton from "@/components/map/NearMeButton";
import { useMapLocate } from "@/components/map/useMapLocate";

/*
 * /map's location card (owner's mockup, 8 Nov 2026) with the real useMapLocate: what it says, how
 * long it stays (WCAG 2.2.1), its ✕, and that it never takes focus. The browser refuses every ask.
 */

const INSTAGRAM_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU)";

function Harness() {
  const locate = useMapLocate(false);
  return (
    <div>
      <NearMeButton
        onLocate={locate.locate}
        locating={locate.locating}
        status={locate.status}
        onDismiss={locate.dismissStatus}
        onHold={locate.holdStatus}
        onExtend={locate.extendStatus}
      />
      <button type="button">Elsewhere</button>
    </div>
  );
}

const realNavigator = navigator;
const realLocation = window.location;

function refuse(userAgent?: string, clipboard?: { writeText: (text: string) => Promise<void> }) {
  const getCurrentPosition = (_ok: PositionCallback, failure?: PositionErrorCallback | null) =>
    failure?.({ code: 1, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  vi.stubGlobal(
    "navigator",
    Object.create(navigator, {
      geolocation: { value: { getCurrentPosition } },
      userAgent: { value: userAgent ?? navigator.userAgent },
      clipboard: { value: clipboard },
    }),
  );
}

/** Presses Near me (focused first, as a tap or a key press leaves it) and waits for the card. */
async function pressNearMe() {
  const nearMe = screen.getByRole("button", { name: "Near me" });
  nearMe.focus();
  await act(async () => {
    fireEvent.click(nearMe);
  });
  return nearMe;
}

const card = () => document.querySelector<HTMLElement>("[data-location-card]");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.stubGlobal("navigator", realNavigator);
  vi.stubGlobal("location", realLocation);
});

describe("the location card", () => {
  it("asks to share the location, in a status, without taking focus", async () => {
    refuse();
    render(<Harness />);
    const nearMe = await pressNearMe();
    expect(card()).not.toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Share your location?To see events near you, allow location access in your browser settings.");
    expect(card()).toContainElement(status);
    expect(nearMe).toHaveFocus();
  });

  it("stays 20 seconds, long enough to act on (not the 6 of a plain message)", async () => {
    refuse();
    render(<Harness />);
    await pressNearMe();
    act(() => vi.advanceTimersByTime(6_000));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(14_000));
    expect(card()).toBeNull();
    // The status stays mounted (and empty) for the next announcement.
    expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  });

  it("stays while focus is in it, and its time starts again once focus leaves", async () => {
    refuse();
    render(<Harness />);
    await pressNearMe();
    const close = screen.getByRole("button", { name: "Dismiss location message" });
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(card()).not.toBeNull();
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    act(() => vi.advanceTimersByTime(19_000));
    expect(card()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(card()).toBeNull();
  });

  it("✕ closes it and gives focus back to Near me", async () => {
    refuse();
    render(<Harness />);
    await pressNearMe();
    const close = screen.getByRole("button", { name: "Dismiss location message" });
    act(() => close.focus());
    fireEvent.click(close);
    expect(card()).toBeNull();
    expect(screen.getByRole("button", { name: "Near me" })).toHaveFocus();
  });

  it("iOS in-app: the copied link's steps get their own 20 seconds, and a new failure starts the card afresh", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    refuse(INSTAGRAM_IOS, { writeText });
    vi.stubGlobal("location", new URL("https://app.sheltuh.com.au/map?view=list#x"));
    render(<Harness />);
    await pressNearMe();
    act(() => vi.advanceTimersByTime(15_000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in Safari" }));
    });
    expect(writeText).toHaveBeenCalledWith("https://app.sheltuh.com.au/map?view=list");
    expect(screen.getByRole("status")).toHaveTextContent("Link copied. Tap ••• at the top, then Open in external browser.");
    // Pressing it put focus on it: move away, as switching to the app's menu would.
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    act(() => vi.advanceTimersByTime(15_000));
    expect(card()).not.toBeNull();

    await pressNearMe();
    expect(screen.getByRole("status")).toHaveTextContent("To see events near you, allow location access in Safari.");
  });
});
