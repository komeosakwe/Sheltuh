// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NameList from "@/components/whos-going/NameList";
import type { GoingAttendee } from "@/lib/api/types";

const fetchAvatar = vi.fn();
vi.mock("@/lib/api/profiles", () => ({
  fetchAvatar: (...args: unknown[]) => fetchAvatar(...args),
}));

/** A controllable IntersectionObserver: rows "scroll into view" when the test says so. */
const observers: { callback: IntersectionObserverCallback; elements: Element[] }[] = [];
class FakeObserver {
  private entry: { callback: IntersectionObserverCallback; elements: Element[] };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, elements: [] };
    observers.push(this.entry);
  }
  observe(element: Element) {
    this.entry.elements.push(element);
  }
  disconnect() {
    this.entry.elements = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
function scrollIntoView(element: Element) {
  for (const o of observers) {
    if (o.elements.includes(element)) {
      o.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  }
}

beforeEach(() => {
  observers.length = 0;
  fetchAvatar.mockReset();
  fetchAvatar.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:thumb"), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const attendees: GoingAttendee[] = [
  {
    attendeeId: "a1",
    displayName: "Aisha L.",
    isYou: false,
    profileId: "p-aisha",
    hasAvatar: true,
    avatarThumbUrl: "/api/profiles/p-aisha/avatar?size=thumb&v=1",
  },
  { attendeeId: "a2", displayName: "Leo V.", isYou: false, profileId: "p-leo", hasAvatar: false },
  { attendeeId: "a3", displayName: "Quinn C.", isYou: false, hasAvatar: false },
];

describe("NameList with member profiles", () => {
  it("links names with a profileId to /members/{id}; the rest stay plain text", () => {
    render(<NameList attendees={attendees} getToken={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Aisha L." })).toHaveAttribute("href", "/members/p-aisha");
    expect(screen.getByRole("link", { name: "Leo V." })).toHaveAttribute("href", "/members/p-leo");
    expect(screen.queryByRole("link", { name: "Quinn C." })).toBeNull();
    expect(screen.getByText("Quinn C.")).toBeInTheDocument();
  });

  it("fetches a thumbnail only once its row is visible, and only for profiles with a photo", async () => {
    const { container } = render(<NameList attendees={attendees} getToken={vi.fn().mockResolvedValue("t")} />);
    // Nothing yet: no row has scrolled into view.
    expect(fetchAvatar).not.toHaveBeenCalled();
    // Initials meanwhile.
    expect(screen.getByText("AL")).toBeInTheDocument();
    const aishaAvatar = screen.getByText("AL").closest("span[aria-hidden]")?.parentElement as Element;
    act(() => scrollIntoView(aishaAvatar));
    await waitFor(() => expect(container.querySelector("img[data-member-photo]")).toHaveAttribute("src", "blob:thumb"));
    expect(fetchAvatar).toHaveBeenCalledTimes(1);
    expect(fetchAvatar).toHaveBeenCalledWith(
      "/api/profiles/p-aisha/avatar?size=thumb&v=1",
      expect.any(Function),
      expect.any(AbortSignal),
    );
    // Decorative: the name beside it is what's read.
    expect(container.querySelector("img[data-member-photo]")).toHaveAttribute("alt", "");
    // Leo has no photo, Quinn no profile: initials, never a request.
    expect(screen.getByText("LV")).toBeInTheDocument();
    expect(screen.getByText("QC")).toBeInTheDocument();
  });

  it("falls back to initials when the photo can't be seen", async () => {
    fetchAvatar.mockRejectedValue(new Error("404"));
    render(<NameList attendees={[attendees[0]]} getToken={vi.fn()} />);
    const avatar = screen.getByText("AL").closest("span[aria-hidden]")?.parentElement as Element;
    act(() => scrollIntoView(avatar));
    await waitFor(() => expect(fetchAvatar).toHaveBeenCalled());
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("without a token (signed out, demo) shows initials and requests nothing", () => {
    render(<NameList attendees={attendees} />);
    expect(fetchAvatar).not.toHaveBeenCalled();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
