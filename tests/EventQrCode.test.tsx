// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventQrCode from "@/components/dashboard/EventQrCode";
import EventQrSignPage from "@/components/dashboard/EventQrSignPage";
import { ApiError } from "@/lib/api/client";
import type { EventRecord, TrackingLink } from "@/lib/api/types";
import { linkQrMatrix, linkQrSvg } from "@/lib/link-qr";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));
const api = { getMyEvent: vi.fn(), ensureQrTrackingLink: vi.fn() };
vi.mock("@/lib/api/events", () => ({ getMyEvent: (...a: unknown[]) => api.getMyEvent(...a) }));
vi.mock("@/lib/api/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/analytics")>()),
  ensureQrTrackingLink: (...a: unknown[]) => api.ensureQrTrackingLink(...a),
}));
const saveBlob = vi.fn();
vi.mock("@/components/analytics/ExportCsvButton", () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) }));
const linkQrPngBlob = vi.fn();
vi.mock("@/lib/link-qr-png", () => ({ linkQrPngBlob: (...a: unknown[]) => linkQrPngBlob(...a) }));

const TRACKED_URL = "https://sheltuh.com.au/events/night-market?ref=k7mq2hxd";

function event(extra: Partial<EventRecord> = {}): EventRecord {
  return {
    organiserId: "org-1",
    eventId: "evt-1",
    slug: "night-market",
    title: "Night Market",
    description: "",
    category: "markets",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    state: "VIC",
    timeZone: "Australia/Melbourne",
    startsAt: "2026-12-05T09:00:00.000Z",
    endsAt: "2026-12-05T12:00:00.000Z",
    organiserName: "Northside Noise",
    ticketTypes: [{ id: "ga", name: "General", priceCents: 2500, feePolicy: "buyer-pays", quantityAvailable: 50 }],
    ticketingMode: "sheltuh",
    status: "published",
    moderationLog: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  } as EventRecord;
}

const LINK: TrackingLink = {
  linkId: "l1",
  code: "k7mq2hxd",
  label: "QR code",
  url: TRACKED_URL,
  createdAt: "2026-11-26T00:00:00.000Z",
  views: 0,
  orders: 0,
  ticketsSold: 0,
  grossCents: 0,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  saveBlob.mockReset();
  linkQrPngBlob.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderWith(ui: React.ReactNode, auth = fakeAuthValue()) {
  return render(<FakeAuthProvider value={auth}>{ui}</FakeAuthProvider>);
}

describe("EventQrCode", () => {
  it("draws the tracked code for a published event, black on a white plate, and says where it opens", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    renderWith(<EventQrCode eventId="evt-1" />);
    const img = await screen.findByRole("img", { name: "QR code for sheltuh.com.au/events/night-market" });
    expect(api.getMyEvent).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(api.ensureQrTrackingLink).toHaveBeenCalledWith("evt-1", expect.any(Function));
    // The plate: white, the modules black, as SVG attributes (no theme can tint them), crisp.
    expect(img.querySelector("rect")).toHaveAttribute("fill", "#ffffff");
    expect(img.querySelector("path")).toHaveAttribute("fill", "#000000");
    expect(img).toHaveAttribute("shape-rendering", "crispEdges");
    expect(img).toHaveStyle({ colorScheme: "only light" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("QR code");
    expect(screen.getByText("Night Market")).toBeInTheDocument();
    expect(screen.getByText("sheltuh.com.au/events/night-market")).toBeInTheDocument();
    expect(screen.getByText(/They’re page views, not scans\./)).toBeInTheDocument();
    expect(screen.getByText(/If you delete it, this code stops counting/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Printable sign" })).toHaveAttribute("href", "/dashboard/events/evt-1/qr/sign");
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("href", "/dashboard/events/evt-1/analytics");
    expect(screen.getByRole("link", { name: "Edit event" })).toHaveAttribute("href", "/dashboard/evt-1");
  });

  it("downloads the SVG (the code alone) and the PNG, named after the slug, and says so", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    const png = new Blob(["png"], { type: "image/png" });
    linkQrPngBlob.mockResolvedValue(png);
    renderWith(<EventQrCode eventId="evt-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download SVG" }));
    const [svgBlob, svgName] = saveBlob.mock.calls[0];
    expect(svgName).toBe("sheltuh-night-market-qr.svg");
    expect(svgBlob.type).toBe("image/svg+xml");
    expect(await (svgBlob as Blob).text()).toBe(linkQrSvg(linkQrMatrix(TRACKED_URL)!));
    expect(screen.getByRole("status")).toHaveTextContent("SVG downloaded.");

    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(2));
    expect(linkQrPngBlob).toHaveBeenCalledWith(linkQrMatrix(TRACKED_URL));
    expect(saveBlob.mock.calls[1]).toEqual([png, "sheltuh-night-market-qr.png"]);
    expect(screen.getByRole("status")).toHaveTextContent("PNG downloaded.");
  });

  it("shows a PNG that can't be made, and keeps the SVG on offer", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    linkQrPngBlob.mockRejectedValue(new Error("no canvas"));
    renderWith(<EventQrCode eventId="evt-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download PNG" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t make the PNG. Try again, or download the SVG.");
    expect(saveBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download PNG" })).not.toHaveAttribute("aria-disabled");
  });

  it("at the 20-link cap, opens the plain event page and says why it isn't tracked", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sheltuh.com.au");
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(null);
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByRole("img", { name: "QR code for sheltuh.com.au/events/night-market" })).toBeInTheDocument();
    expect(screen.getByText(/You have 20 tracking links, the most for one event/)).toBeInTheDocument();
    expect(screen.queryByText(/page views, not scans/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download SVG" }));
    expect(await (saveBlob.mock.calls[0][0] as Blob).text()).toBe(linkQrSvg(linkQrMatrix("https://sheltuh.com.au/events/night-market")!));
  });

  it("shows a failure to get the code ready, with Try again, which loads it afresh", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockRejectedValueOnce(new ApiError(500, "Server error.")).mockResolvedValueOnce(LINK);
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t get the QR code ready. Try again.");
    expect(screen.queryByRole("img", { name: /QR code for/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img", { name: /QR code for/ })).toBeInTheDocument();
    expect(api.ensureQrTrackingLink).toHaveBeenCalledTimes(2);
  });

  it("an ended session offers Sign in, back to this page, instead of Try again", async () => {
    api.getMyEvent.mockRejectedValue(new ApiError(401, "Unauthorised."));
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has ended. Sign in again to get the QR code.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=${encodeURIComponent("/dashboard/events/evt-1/qr")}`);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("on the sign, Sign in comes back to the sign", async () => {
    api.getMyEvent.mockRejectedValue(new ApiError(401, "Unauthorised."));
    renderWith(<EventQrSignPage eventId="evt-1" />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=${encodeURIComponent("/dashboard/events/evt-1/qr/sign")}`);
  });

  it("an address that can't be a QR code: no Try again (it can't help), and a way to contact Sheltüh", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue({ ...LINK, url: "javascript:alert(1)" });
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This event’s address can’t be made into a QR code. Contact Sheltüh.");
    expect(screen.getByRole("link", { name: "Contact Sheltüh" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("img", { name: /QR code for/ })).toBeNull();
  });

  it.each(["draft", "pending_review", "rejected"] as const)("a %s event has no code, and no tracking link is made", async (status) => {
    api.getMyEvent.mockResolvedValue(event({ status }));
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByText("Publish your event first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your event" })).toHaveAttribute("href", "/dashboard/evt-1");
    expect(api.ensureQrTrackingLink).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: /QR code for/ })).toBeNull();
  });

  it("another organiser's (or a deleted) event is not found", async () => {
    api.getMyEvent.mockRejectedValue(new ApiError(404, "Event not found."));
    renderWith(<EventQrCode eventId="evt-1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Event not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to events" })).toHaveAttribute("href", "/dashboard/events");
    expect(api.ensureQrTrackingLink).not.toHaveBeenCalled();
  });

  it("loads once under React's double effects (Strict Mode): one event read, one tracking-link call", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    renderWith(
      <StrictMode>
        <EventQrCode eventId="evt-1" />
      </StrictMode>,
    );
    expect(await screen.findByRole("img", { name: /QR code for/ })).toBeInTheDocument();
    expect(api.getMyEvent).toHaveBeenCalledTimes(1);
    expect(api.ensureQrTrackingLink).toHaveBeenCalledTimes(1);
  });

  it("an account switch mid-load never shows the first account's event, whenever its answer arrives", async () => {
    const deferred = () => {
      let resolve!: (value: EventRecord) => void;
      const promise = new Promise<EventRecord>((r) => (resolve = r));
      return { promise, resolve };
    };
    const forA = deferred();
    const forB = deferred();
    api.getMyEvent.mockReturnValueOnce(forA.promise).mockReturnValueOnce(forB.promise);
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    const a = fakeAuthValue({ userId: "user-a", email: "a@example.com" });
    // As AuthContext's: the same token functions whichever account is signed in.
    const b = fakeAuthValue({ userId: "user-b", email: "b@example.com", getAccessToken: a.getAccessToken, getAccessTokenFor: a.getAccessTokenFor });
    const view = render(
      <FakeAuthProvider value={a}>
        <EventQrCode eventId="evt-1" />
      </FakeAuthProvider>,
    );
    await waitFor(() => expect(api.getMyEvent).toHaveBeenCalledTimes(1));
    view.rerender(
      <FakeAuthProvider value={b}>
        <EventQrCode eventId="evt-1" />
      </FakeAuthProvider>,
    );
    // B's own load starts: A's unfinished one is never handed over.
    await waitFor(() => expect(api.getMyEvent).toHaveBeenCalledTimes(2));
    await act(async () => forA.resolve(event({ title: "A's secret event" })));
    expect(screen.queryByText("A's secret event")).toBeNull();
    expect(screen.queryByRole("img", { name: /QR code for/ })).toBeNull();
    await act(async () => forB.resolve(event({ title: "B's event" })));
    expect(await screen.findByText("B's event")).toBeInTheDocument();
    expect(screen.queryByText("A's secret event")).toBeNull();
  });

  it("in the demo (no accounts) says so and calls nothing", () => {
    renderWith(<EventQrCode eventId="evt-1" />, fakeAuthValue({ configured: false }));
    expect(screen.getByRole("heading", { level: 1, name: "QR code" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(api.getMyEvent).not.toHaveBeenCalled();
  });

  it("signed out, asks to sign in and come back here", () => {
    renderWith(<EventQrCode eventId="evt-1" />, fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=${encodeURIComponent("/dashboard/events/evt-1/qr")}`);
    expect(api.getMyEvent).not.toHaveBeenCalled();
  });
});

describe("EventQrSignPage", () => {
  const print = vi.fn();
  beforeEach(() => {
    print.mockReset();
    vi.spyOn(window, "print").mockImplementation(print);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lays out the sign: wordmark, title, date in the event's zone, venue, the code, what scanning does and the address", async () => {
    api.getMyEvent.mockResolvedValue(event({ timeZone: "Australia/Perth", state: "WA", suburb: "Northbridge" }));
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    renderWith(<EventQrSignPage eventId="evt-1" />);
    const sheet = await screen.findByRole("region", { name: "Sign preview, A4" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Printable sign");
    expect(within(sheet).getByRole("img", { name: "Sheltüh" })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { level: 2 })).toHaveTextContent("Night Market");
    // 9:00 am UTC is 5:00 pm in Perth: the event's own zone, not Melbourne's 8:00 pm.
    expect(within(sheet).getByText("Sat 5 Dec, 5:00 pm – 8:00 pm")).toBeInTheDocument();
    expect(within(sheet).getByText("Perth time (AWST)")).toBeInTheDocument();
    expect(within(sheet).getByText("The Tote, Northbridge, WA")).toBeInTheDocument();
    expect(within(sheet).getByRole("img", { name: "QR code for sheltuh.com.au/events/night-market" })).toBeInTheDocument();
    expect(within(sheet).getByText("Scan for tickets")).toBeInTheDocument();
    expect(within(sheet).getByText("sheltuh.com.au/events/night-market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← QR code" })).toHaveAttribute("href", "/dashboard/events/evt-1/qr");
  });

  it("“Scan to see the event” for a free or externally ticketed event", async () => {
    api.getMyEvent.mockResolvedValue(event({ ticketingMode: "external", ticketTypes: [], externalTicketUrl: "https://humanitix.com/x" }));
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    renderWith(<EventQrSignPage eventId="evt-1" />);
    const sheet = await screen.findByRole("region", { name: "Sign preview, A4" });
    expect(within(sheet).getByText("Scan to see the event")).toBeInTheDocument();
  });

  it("shows the organiser's title and venue as text: markup in them is never markup", async () => {
    const title = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    api.getMyEvent.mockResolvedValue(event({ title, venueName: '<svg onload="alert(3)">Tote</svg>' }));
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    renderWith(<EventQrSignPage eventId="evt-1" />);
    const sheet = await screen.findByRole("region", { name: "Sign preview, A4" });
    expect(within(sheet).getByRole("heading", { level: 2 }).textContent).toBe(title);
    expect(within(sheet).getByText('<svg onload="alert(3)">Tote</svg>, Collingwood, VIC')).toBeInTheDocument();
    expect(sheet.querySelector("img, script, [onerror], [onload]")).toBeNull();
    // The only SVGs are the wordmark's and the code's.
    expect(sheet.querySelectorAll("svg")).toHaveLength(2);
  });

  it("prints the chosen paper: A4 by default, A5 when chosen, each a portrait page with no margin", async () => {
    api.getMyEvent.mockResolvedValue(event());
    api.ensureQrTrackingLink.mockResolvedValue(LINK);
    const { container } = renderWith(<EventQrSignPage eventId="evt-1" />);
    const sheet = await screen.findByRole("region", { name: "Sign preview, A4" });
    expect(sheet).toHaveAttribute("data-print-sheet");
    expect(sheet).toHaveAttribute("data-paper", "a4");
    expect(sheet).toHaveClass("qr-sign");
    expect(container.querySelector("style")?.textContent).toBe("@page { size: A4 portrait; margin: 0; }");
    const group = screen.getByRole("group", { name: "Paper size" });
    expect(within(group).getByRole("radio", { name: "A4" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "A5" }));
    expect(screen.getByRole("region", { name: "Sign preview, A5" })).toHaveAttribute("data-paper", "a5");
    expect(container.querySelector("style")?.textContent).toBe("@page { size: A5 portrait; margin: 0; }");
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toHaveAccessibleDescription("Choose A5 paper, portrait, at 100%.");
    fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("an unpublished event gets no sign and no tracking link", async () => {
    api.getMyEvent.mockResolvedValue(event({ status: "draft" }));
    renderWith(<EventQrSignPage eventId="evt-1" />);
    expect(await screen.findByText("Publish your event first")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Sign preview/ })).toBeNull();
    expect(api.ensureQrTrackingLink).not.toHaveBeenCalled();
  });
});

describe("the sign's print stylesheet (app/globals.css)", () => {
  const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
  const print = css.slice(css.lastIndexOf("@media print {"));

  it("prints only the sheet: everything else on the page is hidden, and what holds it is flattened", () => {
    expect(print).toContain(
      "body:has([data-print-sheet]) :not(:has([data-print-sheet]), [data-print-sheet], [data-print-sheet] *) {\n    display: none !important;",
    );
    expect(print).toMatch(/body:has\(\[data-print-sheet\]\) :has\(\[data-print-sheet\]\) \{[^}]*padding: 0 !important;[^}]*background: none !important;/);
  });

  it("sizes the sheet to the paper (a hair under its height, so it's one page)", () => {
    expect(print).toMatch(/\.qr-sign\[data-paper="a4"\] \{\s*width: 210mm;\s*height: 296\.5mm;/);
    expect(print).toMatch(/\.qr-sign\[data-paper="a5"\] \{\s*width: 148mm;\s*height: 209\.5mm;/);
  });

  it("keeps the sheet white with black ink in every theme and when printing without background graphics", () => {
    const sheet = /\.qr-sign \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(sheet).toContain("background: var(--paper);");
    expect(sheet).toContain("color: var(--ink);");
    expect(sheet).toContain("print-color-adjust: exact;");
    expect(sheet).toContain("forced-color-adjust: none;");
  });
});
