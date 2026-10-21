// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackingLinks, { createErrorMessage, labelError } from "@/components/analytics/TrackingLinks";
import { ApiError } from "@/lib/api/client";
import { link } from "./test-utils/analyticsFixtures";

const api = { listTrackingLinks: vi.fn(), createTrackingLink: vi.fn(), deleteTrackingLink: vi.fn() };
vi.mock("@/lib/api/analytics", () => ({
  listTrackingLinks: (...a: unknown[]) => api.listTrackingLinks(...a),
  createTrackingLink: (...a: unknown[]) => api.createTrackingLink(...a),
  deleteTrackingLink: (...a: unknown[]) => api.deleteTrackingLink(...a),
}));

const getToken = vi.fn().mockResolvedValue("t");
const writeText = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

function renderLinks() {
  return render(<TrackingLinks eventId="evt-1" getToken={getToken} />);
}

/** The desktop table (the phone list is display:none there; jsdom shows both). */
const table = () => screen.getByRole("table", { name: "Tracking links, totals since each was created" });

describe("TrackingLinks", () => {
  it("loads the event's links with all-time numbers", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "Instagram bio")] });
    renderLinks();
    const row = (await within(await screen.findByRole("table")).findByRole("rowheader", { name: "Instagram bio" })).closest("tr");
    expect(row).toHaveTextContent("https://sheltuh.com.au/events/night-market?ref=l1");
    expect(row).toHaveTextContent("A$120.50");
    expect(screen.getByText("1 of 20 links")).toBeInTheDocument();
    expect(api.listTrackingLinks).toHaveBeenCalledWith("evt-1", getToken);
  });

  it("empty: says what links are for", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [] });
    renderLinks();
    expect(await screen.findByText("No links yet. Make one for each place you post about this event.")).toBeInTheDocument();
  });

  it("a load error has Try again", async () => {
    api.listTrackingLinks.mockRejectedValueOnce(new ApiError(500, "x")).mockResolvedValue({ items: [] });
    renderLinks();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your tracking links.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No links yet/)).toBeInTheDocument();
  });

  it("creates a link: adds it on top, clears the field, keeps focus there and announces it", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "Old")] });
    api.createTrackingLink.mockResolvedValue(link("l2", "Newsletter"));
    renderLinks();
    const input = await screen.findByLabelText("Label");
    fireEvent.change(input, { target: { value: "  Newsletter " } });
    expect(screen.getByText("13/40")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(api.createTrackingLink).toHaveBeenCalledWith("evt-1", { label: "Newsletter" }, getToken);
    const headers = within(table()).getAllByRole("rowheader").map((h) => h.textContent);
    expect(headers).toEqual(["Newsletter", "Old"]);
    // Focus moves in an effect after the commit that cleared the field, which
    // can still be pending when the waitFor above resolves.
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText("Link created: Newsletter.")).toHaveAttribute("role", "status");
  });

  it("checks the label first, counting code points", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [] });
    renderLinks();
    const input = await screen.findByLabelText("Label");
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a label.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(api.createTrackingLink).not.toHaveBeenCalled();
    expect(labelError("🎟️".repeat(20))).toBeNull(); // 40 code points
    expect(labelError("x".repeat(41))).toBe("Keep it to 40 characters or fewer.");
  });

  it("maps the API's errors", () => {
    expect(createErrorMessage(new ApiError(409, "Taken.", { label: "Taken." }), " Bio ").message).toBe("You already have a link called “Bio”.");
    expect(createErrorMessage(new ApiError(409, "Too many."), "Bio")).toEqual({
      message: "You've made 20 links, the most for one event. Delete one to make another.",
      atCap: true,
    });
    expect(createErrorMessage(new ApiError(400, "Bad.", { label: "No control characters." }), "x").message).toBe("No control characters.");
    expect(createErrorMessage(new ApiError(401, "x"), "x").message).toMatch(/session has ended/);
    expect(createErrorMessage(new TypeError("offline"), "x").message).toBe("Couldn't make the link. Try again.");
  });

  it("a duplicate label is refused on the form, which stays usable", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [] });
    api.createTrackingLink.mockRejectedValue(new ApiError(409, "Taken.", { label: "Taken." }));
    renderLinks();
    fireEvent.change(await screen.findByLabelText("Label"), { target: { value: "Bio" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already have a link called “Bio”.");
    expect(screen.getByRole("button", { name: "Create link" })).not.toHaveAttribute("aria-disabled");
  });

  it("at 20 links the form is replaced by a note", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: Array.from({ length: 20 }, (_, i) => link(`l${i}`, `Link ${i}`)) });
    renderLinks();
    expect(await screen.findByText(/You’ve made 20 links, the most for one event/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Label")).toBeNull();
    expect(screen.getByText("20 of 20 links")).toBeInTheDocument();
  });

  it("copies a link: 'Copied' and an announcement", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "Bio")] });
    renderLinks();
    const copy = await within(await screen.findByRole("table")).findByRole("button", { name: "Copy link for Bio" });
    await act(async () => fireEvent.click(copy));
    expect(writeText).toHaveBeenCalledWith("https://sheltuh.com.au/events/night-market?ref=l1");
    expect(within(table()).getByRole("button", { name: "Copied link for Bio" })).toBeInTheDocument();
    expect(screen.getByText("Link for Bio copied.")).toBeInTheDocument();
  });

  it("when copying fails, selects the link for copying by hand", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "Bio")] });
    renderLinks();
    const copy = await within(await screen.findByRole("table")).findByRole("button", { name: "Copy link for Bio" });
    await act(async () => fireEvent.click(copy));
    const field = within(table()).getByRole("textbox", { name: "Link for Bio" });
    expect(field).toHaveAttribute("readonly");
    expect(within(table()).getByText("Couldn’t copy. The link is selected, so copy it yourself.")).toBeInTheDocument();
  });

  it("delete asks inline: focus to Cancel, Cancel returns to Delete", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "Bio")] });
    renderLinks();
    const del = await within(await screen.findByRole("table")).findByRole("button", { name: "Delete Bio" });
    fireEvent.click(del);
    const group = screen.getByRole("group", { name: "Delete “Bio”?" });
    expect(within(group).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(group).toHaveTextContent("The link will still open your event");
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Delete Bio" })).toContain(document.activeElement);
    expect(api.deleteTrackingLink).not.toHaveBeenCalled();
  });

  it("deleting moves focus to the next row's Copy (else the Label field) and announces it", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "One"), link("l2", "Two")] });
    api.deleteTrackingLink.mockResolvedValue(undefined);
    renderLinks();
    fireEvent.click(await within(await screen.findByRole("table")).findByRole("button", { name: "Delete One" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(within(table()).queryByRole("rowheader", { name: "One" })).toBeNull());
    expect(api.deleteTrackingLink).toHaveBeenCalledWith("evt-1", "l1", getToken);
    // As on create: focus moves in an effect that can still be pending here.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Copy link for Two" })).toContain(document.activeElement));
    expect(screen.getByText("Deleted One.")).toBeInTheDocument();

    fireEvent.click(within(table()).getByRole("button", { name: "Delete Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.getByLabelText("Label")).toHaveFocus());
  });

  it("a failed delete keeps the confirm open with an error", async () => {
    api.listTrackingLinks.mockResolvedValue({ items: [link("l1", "One")] });
    api.deleteTrackingLink.mockRejectedValue(new ApiError(500, "x"));
    renderLinks();
    fireEvent.click(await within(await screen.findByRole("table")).findByRole("button", { name: "Delete One" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText("Couldn't delete it. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, delete" })).not.toHaveAttribute("aria-disabled");
    expect(within(table()).getByRole("rowheader", { name: "One" })).toBeInTheDocument();
  });
});
