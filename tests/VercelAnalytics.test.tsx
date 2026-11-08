// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VercelAnalytics from "@/components/analytics/VercelAnalytics";

type Send = (event: { url: string; route?: string }) => { url: string; route?: string } | null;
const analyticsProps = vi.fn();
const speedProps = vi.fn();
vi.mock("@vercel/analytics/next", () => ({
  Analytics: (props: { beforeSend: Send }) => {
    analyticsProps(props);
    return <span data-testid="web-analytics" />;
  },
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: { beforeSend: Send }) => {
    speedProps(props);
    return <span data-testid="speed-insights" />;
  },
}));

function setNavigator(values: { doNotTrack?: string | null; globalPrivacyControl?: boolean }) {
  for (const [name, value] of Object.entries(values)) Object.defineProperty(window.navigator, name, { value, configurable: true });
}

beforeEach(() => {
  analyticsProps.mockReset();
  speedProps.mockReset();
  setNavigator({ doNotTrack: null, globalPrivacyControl: false });
});
afterEach(cleanup);

describe("VercelAnalytics", () => {
  it("renders Web Analytics and Speed Insights, each with a beforeSend that drops /admin and cleans addresses", () => {
    const { getByTestId } = render(<VercelAnalytics />);
    expect(getByTestId("web-analytics")).toBeInTheDocument();
    expect(getByTestId("speed-insights")).toBeInTheDocument();
    for (const mock of [analyticsProps, speedProps]) {
      const { beforeSend } = mock.mock.calls[0][0] as { beforeSend: Send };
      expect(beforeSend({ url: "https://sheltuh.com.au/admin/payouts" })).toBeNull();
      expect(beforeSend({ url: "https://sheltuh.com.au/checkout/success?session_id=ord_1&utm_source=x#t" })).toEqual({
        url: "https://sheltuh.com.au/checkout/success?utm_source=x",
      });
    }
  });

  it.each([
    ["Do Not Track", { doNotTrack: "1" }],
    ["Global Privacy Control", { globalPrivacyControl: true }],
  ])("loads neither tool for a browser sending %s", (_name, signals) => {
    setNavigator(signals);
    const { queryByTestId } = render(<VercelAnalytics />);
    expect(queryByTestId("web-analytics")).toBeNull();
    expect(queryByTestId("speed-insights")).toBeNull();
    expect(analyticsProps).not.toHaveBeenCalled();
  });

  it("drops events if the visitor opts out after it has loaded", () => {
    render(<VercelAnalytics />);
    const { beforeSend } = analyticsProps.mock.calls[0][0] as { beforeSend: Send };
    setNavigator({ globalPrivacyControl: true });
    expect(beforeSend({ url: "https://sheltuh.com.au/" })).toBeNull();
  });
});
