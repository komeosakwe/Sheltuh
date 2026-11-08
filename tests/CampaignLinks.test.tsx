// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CampaignLinks from "@/components/admin/CampaignLinks";
import { AuthContext, type AuthContextValue } from "@/lib/auth/AuthContext";
import type { AdminEventRecord } from "@/lib/api/types";

const adminListEvents = vi.fn();
const adminListOrganisers = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListEvents: (...args: unknown[]) => adminListEvents(...args),
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
}));

const auth = { status: "signed-in", isAdmin: true, getAccessToken: async () => "token" } as unknown as AuthContextValue;

function renderPage() {
  return render(
    <AuthContext.Provider value={auth}>
      <CampaignLinks />
    </AuthContext.Provider>,
  );
}

const writeText = vi.fn();
beforeEach(() => {
  adminListEvents.mockReset();
  adminListOrganisers.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillIn() {
  type("Source", "Instagram");
  type("Medium", "bio");
  type("Campaign name", "Spring Launch");
}

describe("CampaignLinks", () => {
  it("shows no link until the source, medium and campaign are filled in", async () => {
    renderPage();
    expect(await screen.findByText(/Fill in the source, medium and campaign name/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("builds the home page link as typed, saved the way analytics keeps it, with Copy and a QR code", async () => {
    renderPage();
    fillIn();
    const link = await screen.findByLabelText("Campaign link");
    expect(link).toHaveValue(`${window.location.origin}/?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`);
    expect(screen.getByText("Goes in the link as “spring-launch”.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for the campaign link" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(link.getAttribute("value") ?? (link as HTMLTextAreaElement).value);
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("says so when the link can't be copied", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderPage();
    fillIn();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t copy");
  });

  it("links to the map", async () => {
    renderPage();
    choose("Where should it go?", "map");
    fillIn();
    expect(await screen.findByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/map?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );
  });

  it("finds an event by search and links to its page", async () => {
    adminListEvents.mockResolvedValue({
      items: [{ slug: "night-market", title: "Night Market" } as AdminEventRecord],
    });
    renderPage();
    choose("Where should it go?", "event");
    expect(await screen.findByText("1 event found.")).toBeInTheDocument();
    type("Search events", "night");
    await waitFor(() => expect(adminListEvents).toHaveBeenLastCalledWith(expect.objectContaining({ status: "published", q: "night" }), expect.any(Function)));
    expect(await screen.findByText("1 event found.")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Event"), { target: { value: "/events/night-market" } });
    fillIn();
    expect(await screen.findByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/events/night-market?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );
  });

  it("finds an organiser and links to its page", async () => {
    adminListOrganisers.mockResolvedValue({ items: [{ organiserId: "org-1", displayName: "Tote Presents" }] });
    renderPage();
    choose("Where should it go?", "organiser");
    expect(await screen.findByText("1 organiser found.")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Organiser"), { target: { value: "/organisers/org-1" } });
    fillIn();
    expect(await screen.findByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/organisers/org-1?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );
  });

  it("says when nothing matches and shows a search failure", async () => {
    adminListEvents.mockResolvedValueOnce({ items: [] });
    renderPage();
    choose("Where should it go?", "event");
    expect(await screen.findByText("No events match.")).toBeInTheDocument();
    adminListEvents.mockRejectedValue(new Error("Server down"));
    type("Search events", "x");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
  });

  it("keeps the picked event (and its link) when a new search doesn't find it, and clears it when the destination changes", async () => {
    adminListEvents.mockImplementation(async (query: { q?: string }) => ({
      items: query.q === "jazz" ? [{ slug: "jazz-night", title: "Jazz Night" }] : [{ slug: "night-market", title: "Night Market" }],
    }));
    renderPage();
    choose("Where should it go?", "event");
    expect(await screen.findByText("1 event found.")).toBeInTheDocument();
    choose("Event", "/events/night-market");
    fillIn();
    expect(await screen.findByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/events/night-market?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );

    // A search that doesn't find it: the pick is still the selected option, and the link still says it.
    type("Search events", "jazz");
    await waitFor(() => expect(adminListEvents).toHaveBeenLastCalledWith(expect.objectContaining({ q: "jazz" }), expect.any(Function)));
    expect(await screen.findByText("1 event found.")).toBeInTheDocument();
    const select = screen.getByLabelText("Event") as HTMLSelectElement;
    expect(select).toHaveValue("/events/night-market");
    expect(within(select).getByRole("option", { name: "Night Market (night-market)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Jazz Night (jazz-night)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/events/night-market?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );

    // While a search is loading the pick is still there too.
    type("Search events", "jazz x");
    expect(select).toHaveValue("/events/night-market");

    // Choosing from the new results replaces it.
    type("Search events", "jazz");
    await waitFor(() => expect(within(select).queryByRole("option", { name: "Jazz Night (jazz-night)" })).not.toBeNull());
    choose("Event", "/events/jazz-night");
    expect(screen.getByLabelText("Campaign link")).toHaveValue(
      `${window.location.origin}/events/jazz-night?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`,
    );

    // Another destination: the pick is cleared, and coming back to events starts with nothing chosen.
    choose("Where should it go?", "organiser");
    expect(screen.queryByLabelText("Campaign link")).toBeNull();
    choose("Where should it go?", "event");
    await screen.findByText("1 event found.");
    expect(screen.getByLabelText("Event")).toHaveValue("");
    expect(screen.queryByLabelText("Campaign link")).toBeNull();
  });

  it("says the link was copied only while the link is the one that was copied", async () => {
    renderPage();
    fillIn();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    // Editing the campaign changes the link: the old answer goes.
    type("Campaign name", "Summer");
    expect(screen.queryByText("Link copied.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("utm_campaign=summer"));
    // Changing it back is another link again: it was copied before, but the answer isn't kept for it.
    type("Campaign name", "Spring Launch");
    expect(screen.queryByText("Link copied.")).toBeNull();
  });

  it("a failed copy is not shown for a later link either", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderPage();
    fillIn();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t copy");
    type("Medium", "story");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
