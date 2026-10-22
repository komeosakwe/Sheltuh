// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MemberProfilePage from "@/app/members/[profileId]/page";
import EventDetailsView from "@/components/EventDetailsView";
import { InboxPageContent, ThreadPageContent } from "@/components/messages/MessagesPages";
import { isApiConfigured } from "@/lib/api/client";
import { sampleEvents } from "@/lib/sample-events";
import { getSampleGoing } from "@/lib/sample-going";
import { getSampleMemberProfile } from "@/lib/sample-member-profiles";
import { SAMPLE_MEMBERS } from "@/lib/sample-members";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The demo's people (no Supabase env, so no API): Who's Going names link to
 * sample member profiles, whose Message opens a demo conversation that keeps
 * what you send in the page. Nothing here may reach the network.
 */

const NOW = new Date("2026-10-01T00:00:00.000Z");
const demoAuth = () => fakeAuthValue({ configured: false, status: "signed-out", email: undefined, accessToken: undefined });

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // Only Date is faked, so promises and testing-library's timers run as usual.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it("runs in demo mode (no API configured)", () => {
  expect(isApiConfigured).toBe(false);
});

describe("Who's Going names (demo)", () => {
  it("links each sample member to their profile; anyone else stays plain text", async () => {
    const event = sampleEvents.find((e) => e.slug === "neon-static");
    if (!event) throw new Error("no sample neon-static");
    const sample = getSampleGoing(event.id);
    render(
      <FakeAuthProvider value={demoAuth()}>
        <EventDetailsView event={event} demo />
      </FakeAuthProvider>,
    );
    // The panel opens on a preview; the names are behind "See who's going" (mobile-redesign.md §6.4.2).
    fireEvent.click(await screen.findByRole("button", { name: "See who’s going" }));
    const list = await screen.findByRole("list", { name: "People going" });
    const shown = sample.attendees.slice(0, 6);
    const members = shown.filter((a) => a.profileId);
    const others = shown.filter((a) => !a.profileId);
    expect(members.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    for (const attendee of members) {
      expect(within(list).getByRole("link", { name: attendee.displayName })).toHaveAttribute(
        "href",
        `/members/${attendee.profileId}`,
      );
    }
    for (const attendee of others) {
      expect(within(list).queryByRole("link", { name: attendee.displayName })).not.toBeInTheDocument();
      expect(within(list).getByText(attendee.displayName)).toBeInTheDocument();
    }
  });

  it("a member is the same person on every list, under the same name", () => {
    for (const member of SAMPLE_MEMBERS) {
      for (const event of sampleEvents) {
        for (const attendee of getSampleGoing(event.id).attendees) {
          if (attendee.displayName.startsWith(`${member.firstName} `)) {
            expect(attendee).toMatchObject({ displayName: member.displayName, profileId: member.profileId });
          }
        }
      }
    }
  });
});

async function renderMember(profileId: string) {
  render(
    <FakeAuthProvider value={demoAuth()}>
      {await MemberProfilePage({ params: Promise.resolve({ profileId }), searchParams: Promise.resolve({}) })}
    </FakeAuthProvider>,
  );
}

describe("/members/[profileId] (demo)", () => {
  it("shows a sample member: name, initials (no photo), bio, Instagram and the events they're going to", async () => {
    await renderMember("priya-r");
    expect(screen.getByRole("heading", { level: 1, name: "Priya R." })).toBeInTheDocument();
    expect(screen.getAllByRole("note")[0]).toHaveTextContent("A fictional member, made up for this demo.");
    expect(document.querySelector("img[data-member-photo]")).toBeNull();
    expect(screen.getByText("PR")).toBeInTheDocument();
    expect(screen.getByText(/Gig regular/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /@sheltuh_demo_priya on Instagram/ })).toHaveAttribute(
      "href",
      "https://www.instagram.com/sheltuh_demo_priya/",
    );

    const expected = getSampleMemberProfile("priya-r", NOW)?.events.map((e) => e.title) ?? [];
    expect(expected.length).toBeGreaterThan(0);
    const section = screen.getByRole("heading", { level: 2, name: "Events Priya R. is going to" }).closest("section");
    if (!section) throw new Error("events section not rendered");
    expect(within(section).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(expected);

    expect(screen.getByRole("link", { name: "Message" })).toHaveAttribute("href", "/messages/priya-r");
  });

  it("Block and Report say what would happen, and change nothing", async () => {
    await renderMember("ben-b");

    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    const confirm = screen.getByRole("group", { name: "Block Ben B.?" });
    expect(within(confirm).getByRole("note")).toHaveTextContent("Blocking isn’t available in this demo");
    expect(within(confirm).queryByRole("button", { name: "Yes, block" })).not.toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("group", { name: "Block Ben B.?" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog", { name: "Report Ben B." });
    fireEvent.click(within(dialog).getByLabelText("Spam or a scam"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/Nothing was sent in this demo\./)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ben B." })).toBeInTheDocument();
  });

  it("an unknown id: the unavailable state", async () => {
    await renderMember("no-such-member");
    expect(screen.getByRole("heading", { level: 1, name: "This profile isn’t available" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("This demo only has a few sample member profiles.");
  });
});

describe("/messages (demo)", () => {
  it("lists the sample conversations, most recent first, in the live inbox's rows", () => {
    render(
      <FakeAuthProvider value={demoAuth()}>
        <InboxPageContent />
      </FakeAuthProvider>,
    );
    const rows = within(screen.getByRole("list", { name: "Conversations" })).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByRole("link").getAttribute("href"))).toEqual([
      "/messages/priya-r",
      "/messages/ben-b",
      "/messages/maeve-d",
    ]);
    expect(rows[0]).toHaveTextContent("Priya R.");
    expect(rows[0]).toHaveTextContent("Neon Static");
    expect(rows[0]).toHaveTextContent("See you by the merch table");
  });
});

function renderThread(conversationId: string) {
  return render(
    <FakeAuthProvider value={demoAuth()}>
      <ThreadPageContent conversationId={conversationId} />
    </FakeAuthProvider>,
  );
}

describe("/messages/[conversationId] (demo)", () => {
  it("shows the sample conversation; sending adds the message to the page only", async () => {
    renderThread("priya-r");
    expect(screen.getByRole("heading", { level: 1, name: "Priya R." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Neon Static" })).toHaveAttribute("href", "/events/neon-static");
    expect(screen.getByText("Messages aren’t sent in this demo. What you write stays on this page.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Messages with Priya R." });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    await waitFor(() => expect(document.title).toBe("Priya R. — Messages — Sheltüh"));

    const box = screen.getByRole("textbox", { name: "Message Priya R." });
    fireEvent.change(box, { target: { value: "  Save me a spot!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4));
    const sent = within(list).getAllByRole("listitem")[3];
    expect(sent).toHaveTextContent("You:");
    expect(sent).toHaveTextContent("Save me a spot!");
    expect(box).toHaveValue("");
    await waitFor(() => expect(screen.getByText("Message added. It isn’t sent in this demo.")).toBeInTheDocument());
  });

  it("doesn't send an empty message", async () => {
    renderThread("priya-r");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const list = screen.getByRole("list", { name: "Messages with Priya R." });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message Priya R." })).toHaveAttribute("aria-invalid", "true"));
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("a sample member with no history starts empty, and the first message shows", async () => {
    renderThread("kai-s");
    expect(screen.getByRole("heading", { level: 1, name: "Kai S." })).toBeInTheDocument();
    expect(screen.getByText("No messages yet. Say hello to Kai S.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Message Kai S." }), { target: { value: "Hi Kai!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const list = await screen.findByRole("list", { name: "Messages with Kai S." });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list).toHaveTextContent("Hi Kai!");
  });

  it("Block and Report say what would happen, and change nothing", async () => {
    renderThread("maeve-d");
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    const confirm = screen.getByRole("group", { name: "Block Maeve D.?" });
    expect(within(confirm).getByRole("note")).toHaveTextContent("Blocking isn’t available in this demo");
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Close" })).toHaveFocus());
    fireEvent.click(within(confirm).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Block" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog", { name: "Report Maeve D." });
    fireEvent.click(within(dialog).getByLabelText("Harassment or bullying"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/Nothing was sent in this demo\./)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Messages with Maeve D." })).toBeInTheDocument();
  });

  it("an id that isn't a sample conversation isn't available", () => {
    renderThread("no-such-conversation");
    expect(screen.getByRole("heading", { level: 1, name: "This conversation isn’t available" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
