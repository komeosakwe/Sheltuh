// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
