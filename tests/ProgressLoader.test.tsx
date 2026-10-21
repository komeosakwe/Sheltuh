// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOLD_MS,
  LoadingIndicator,
  LoadingState,
  ProgressLoader,
  SHOW_COMPLETION_AFTER_MS,
  useLoadingProgress,
} from "@/components/ui/ProgressLoader";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProgressLoader", () => {
  it("is a progressbar named for what's loading, with its value, min and max", () => {
    render(<ProgressLoader percent={42} label="Loading events" />);
    const bar = screen.getByRole("progressbar", { name: "Loading events" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
  });

  it("shows 'Loading 42%' beside the two dots, hidden from screen readers (no announcement per percent)", () => {
    const { container } = render(<ProgressLoader percent={42} label="Loading events" />);
    const text = screen.getByText("Loading 42%");
    expect(text).toHaveAttribute("aria-hidden", "true");
    // The dots move while loading (the animation itself only exists without reduced motion).
    expect(container.querySelector("svg.dots-loader")).not.toBeNull();
    // No live region of its own unless asked: the host owns the start/end announcements.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("at the end reads 'Loaded 100%', with the dots joined and still", () => {
    const { container } = render(<ProgressLoader percent={100} done label="Loading events" />);
    expect(screen.getByText("Loaded 100%")).toBeInTheDocument();
    expect(container.querySelector("svg.dots-loader")).toBeNull();
    expect(container.querySelector("svg[data-joined]")).not.toBeNull();
  });

  it("clamps and rounds the value", () => {
    render(<ProgressLoader percent={140.6} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("with announce, says the label once politely while loading, and nothing when done", () => {
    const { rerender } = render(<ProgressLoader percent={10} label="Loading the map" announce />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the map…");
    rerender(<ProgressLoader percent={100} done label="Loading the map" announce />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

function Probe({ loading }: { loading: boolean }) {
  const progress = useLoadingProgress(loading);
  return (
    <p data-testid="probe">
      {progress.visible ? "visible" : "hidden"} {progress.percent} {progress.done ? "done" : "loading"}
    </p>
  );
}

describe("useLoadingProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  });

  it("eases up while loading and never reaches 100 before it's done", () => {
    render(<Probe loading />);
    expect(screen.getByTestId("probe")).toHaveTextContent("visible 0 loading");
    act(() => vi.advanceTimersByTime(800));
    const midway = Number(screen.getByTestId("probe").textContent?.split(" ")[1]);
    expect(midway).toBeGreaterThan(30);
    expect(midway).toBeLessThan(90);
    act(() => vi.advanceTimersByTime(60_000));
    const late = Number(screen.getByTestId("probe").textContent?.split(" ")[1]);
    expect(late).toBeGreaterThanOrEqual(midway);
    expect(late).toBeLessThan(100);
  });

  it("a slow load completes to 100% and holds it briefly before giving way", () => {
    const { rerender } = render(<Probe loading />);
    act(() => vi.advanceTimersByTime(SHOW_COMPLETION_AFTER_MS + 200));
    rerender(<Probe loading={false} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("visible 100 done");
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(screen.getByTestId("probe")).toHaveTextContent("hidden 100 done");
  });

  it("a quick load gives way at once (no extra wait for the content)", () => {
    const { rerender } = render(<Probe loading />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<Probe loading={false} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("hidden 100 done");
  });

  it("starts again from 0 for the next load", () => {
    const { rerender } = render(<Probe loading />);
    act(() => vi.advanceTimersByTime(2_000));
    rerender(<Probe loading={false} />);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    rerender(<Probe loading />);
    expect(screen.getByTestId("probe")).toHaveTextContent("visible 0 loading");
  });
});

describe("LoadingIndicator and LoadingState", () => {
  it("LoadingIndicator shows the loader while mounted", () => {
    render(<LoadingIndicator label="Loading analytics" />);
    expect(screen.getByRole("progressbar", { name: "Loading analytics" })).toBeInTheDocument();
  });

  it("LoadingState names the bar after the view's own sentence, and says it only once", () => {
    const { container } = render(<LoadingState text="Loading your account…" />);
    expect(screen.getByRole("progressbar", { name: "Loading your account" })).toBeInTheDocument();
    // No second, hidden copy of the sentence for screen readers to hear as well.
    expect(screen.queryByText("Loading your account…")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
  });
});
