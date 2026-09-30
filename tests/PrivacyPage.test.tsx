// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";

afterEach(cleanup);

describe("/privacy — Who's Going", () => {
  it("is linkable as #whos-going and matches the consent copy", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Who’s Going" }).closest("section");
    if (!section) throw new Error("Who's Going section not rendered");
    expect(section).toHaveAttribute("id", "whos-going");
    // Honest: the same name on every event means members can see which ones you've joined.
    expect(section).not.toHaveTextContent("the other events you’ve added yourself to");
    expect(section).toHaveTextContent("It’s the same on every event you add yourself to");
    expect(section).toHaveTextContent("can see which of those events you’ve joined");
    expect(section).toHaveTextContent("add yourself to other events in one tap");
    expect(section).toHaveTextContent("delete your Who’s Going profile to leave every event at once");
    expect(within(section).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute(
      "href",
      "mailto:support@sheltuh.com.au",
    );
  });
});

describe("/privacy — Messages", () => {
  it("is linkable as #messages and states who can message you, silence of declines and blocks, and retention", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Messages" }).closest("section");
    if (!section) throw new Error("Messages section not rendered");
    expect(section).toHaveAttribute("id", "messages");
    expect(section).toHaveTextContent("First contact is a single message request, without links.");
    expect(section).toHaveTextContent("never your email address");
    expect(section).toHaveTextContent("Declining a request and blocking someone are silent");
    expect(section).toHaveTextContent("Conversations and their messages are deleted 12 months after the last message.");
    expect(section).toHaveTextContent("Reports are kept for 2 years after they’re resolved, then deleted.");
    expect(section).toHaveTextContent("Deleting your Who’s Going profile deletes your conversations straight away, for both of you.");
    // The Who's Going section points here.
    const whosGoing = screen.getByRole("heading", { name: "Who’s Going" }).closest("section");
    if (!whosGoing) throw new Error("Who's Going section not rendered");
    expect(within(whosGoing).getByRole("link", { name: "Messages" })).toHaveAttribute("href", "#messages");
    expect(screen.getByRole("note")).toHaveTextContent("Draft");
  });
});
