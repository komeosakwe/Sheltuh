// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import { DETAILS_VISIBLE_MONTHS } from "@/lib/buyer-details";

afterEach(cleanup);

describe("/privacy — header", () => {
  it("carries no draft badge or lawyer-review notice", () => {
    render(<PrivacyPage />);
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText(/plain-language draft/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

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
    expect(section).toHaveTextContent(
      "If you decline a request, we won’t notify the sender, but they won’t be able to message you again.",
    );
    expect(section).toHaveTextContent(
      "If you block someone, we won’t notify them, but they’ll no longer see your conversation or be able to message you",
    );
    expect(section).toHaveTextContent("Conversations and their messages are deleted 12 months after the last message.");
    expect(section).toHaveTextContent("Reports are kept for 2 years after they’re resolved, then deleted.");
    expect(section).toHaveTextContent("Deleting your Who’s Going profile deletes your conversations straight away, for both of you.");
    // The Who's Going section points here.
    const whosGoing = screen.getByRole("heading", { name: "Who’s Going" }).closest("section");
    if (!whosGoing) throw new Error("Who's Going section not rendered");
    expect(within(whosGoing).getByRole("link", { name: "Messages" })).toHaveAttribute("href", "#messages");
  });
});

// Owner round of 24 Oct 2026 (D6): near-you search. The precise position stays in the browser; only the suburb is kept.
describe("/privacy — Your location", () => {
  it("is linkable as #location and matches what the search bar does", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Your location" }).closest("section");
    if (!section) throw new Error("Your location section not rendered");
    expect(section).toHaveAttribute("id", "location");
    expect(section).toHaveTextContent("your browser asks you first");
    expect(section).toHaveTextContent("used only in your browser, to find the nearest suburb we know, and is then thrown away");
    expect(section).toHaveTextContent("It isn’t sent to us, stored, or put in a web address.");
    expect(section).toHaveTextContent("The map asks the same way: when you open it with no suburb saved, and when you press “Near me”.");
    expect(section).toHaveTextContent("if you say no it doesn’t ask again on the map until your next browser session");
    expect(section).toHaveTextContent("only the suburb’s name is kept");
    expect(section).toHaveTextContent("/search?near=Fitzroy");
    expect(section).toHaveTextContent("hosting provider’s request logs");
    expect(section).toHaveTextContent("isn’t saved in our database, isn’t linked to your account, and isn’t sent with our event searches");
    expect(section).toHaveTextContent(
      "Sheltüh doesn’t use your IP address to work out where you are for search, the map or results. Our usage analytics tools may estimate a country or city from it",
    );
    expect(within(section).getByRole("link", { name: "Usage analytics" })).toHaveAttribute("href", "#analytics");
    expect(section).toHaveTextContent("“Anywhere in Australia”");
    expect(section).toHaveTextContent("or search with the location left empty");
    // The address with the suburb in it also lives on in the browser's history.
    expect(section).toHaveTextContent("Search results pages you’ve visited, suburb and all, stay in your browser’s history until you clear it there.");
  });
});

// Google and Apple sign-in (docs/architecture.md, "Sign in with Google and Apple"): what each shares, what we use, linking.
describe("/privacy — Signing in with Google or Apple", () => {
  it("is linkable as #google-apple and says what each provider shares and what we use", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Signing in with Google or Apple" }).closest("section");
    if (!section) throw new Error("Google/Apple section not rendered");
    expect(section).toHaveAttribute("id", "google-apple");
    // It's off until the owner turns it on, so the policy mustn't say it's available.
    expect(section).toHaveTextContent("If we offer sign-in with Google or Apple, you can use it to create an account or sign in");
    expect(section).not.toHaveTextContent("You can create an account or sign in with Google or Apple");
    expect(section).toHaveTextContent(
      "Google: your name, email address, the web address of your profile photo, and your Google account ID.",
    );
    expect(section).toHaveTextContent("Apple: your email address (your real one, or a private relay address if you choose Hide My Email), an Apple account ID");
    // Supabase Auth asks Apple for the name scope; Apple sends it on the first authorisation only.
    expect(section).toHaveTextContent("if you let Apple share it, your name. Apple only sends your name the first time.");
    expect(section).toHaveTextContent("We use only the email address and the account ID");
    expect(section).toHaveTextContent("we don’t use them or show them to anyone");
  });

  it("explains automatic linking, Hide My Email and the providers' own policies", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Signing in with Google or Apple" }).closest("section");
    if (!section) throw new Error("Google/Apple section not rendered");
    expect(section).toHaveTextContent("is verified and already belongs to a Sheltüh account");
    expect(section).toHaveTextContent("the two are linked automatically, and your password keeps working");
    expect(section).toHaveTextContent("anyone who can sign in to that Google or Apple account can sign in to your Sheltüh account");
    expect(section).toHaveTextContent("@privaterelay.appleid.com");
    expect(section).toHaveTextContent("so you’ll have a separate Sheltüh account");
    expect(section).toHaveTextContent("for Who’s Going, book tickets with it");
    expect(section).toHaveTextContent("Google’s and Apple’s own privacy policies apply to what you give them.");
    expect(section).toHaveTextContent("Signing out of Sheltüh doesn’t sign you out of Google or Apple.");
  });

  it("is pointed to from What we collect, and sign-in is listed among our service providers", () => {
    render(<PrivacyPage />);
    const collect = screen.getByRole("heading", { name: "What we collect" }).closest("section");
    if (!collect) throw new Error("What we collect section not rendered");
    expect(collect).toHaveTextContent("if we offer sign-in with Google or Apple and you use it, what they share with us");
    expect(within(collect).getByRole("link", { name: "Signing in with Google or Apple" })).toHaveAttribute(
      "href",
      "#google-apple",
    );
    const sharing = screen.getByRole("heading", { name: "Who we share it with" }).closest("section");
    expect(sharing).toHaveTextContent("for hosting, sign-in, our database (located in Sydney)");
  });
});

describe("/privacy — Payments", () => {
  it("says Stripe's script runs on the payment page, even without paying, and collects fraud-prevention signals", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Payments" }).closest("section");
    if (!section) throw new Error("Payments section not rendered");
    expect(section).toHaveTextContent("Card payments are handled by Stripe. We never see or store your card number.");
    expect(section).toHaveTextContent("Stripe’s script loads on our payment page, including when you open it and don’t pay");
    expect(section).toHaveTextContent("collects information about your device and how the page is used, to help prevent fraud");
    expect(section).toHaveTextContent("Stripe’s privacy policy covers that too.");
  });
});

describe("/privacy — What organisers see", () => {
  it("is linkable as #organiser-orders and says what is shared, for how long, the limits and how to stop it", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "What organisers see" }).closest("section");
    if (!section) throw new Error("Organiser orders section not rendered");
    expect(section).toHaveAttribute("id", "organiser-orders");
    expect(section).toHaveTextContent("Checkout tells you that your name and email are shared with the organiser");
    expect(section).toHaveTextContent("Your name and email address, the tickets you bought, what you paid and when.");
    expect(section).toHaveTextContent(`for ${DETAILS_VISIBLE_MONTHS} months after the event ends`);
    expect(section).toHaveTextContent("for 12 months after the event ends");
    expect(section).toHaveTextContent("Files they exported are theirs, and we can’t take them back.");
    expect(section).toHaveTextContent("Organisers may use these details only for that event.");
    expect(section).toHaveTextContent("Your card details. Stripe handles those.");
    expect(section).toHaveTextContent("Who’s Going only ever shows display names.");
    expect(section).toHaveTextContent("Orders placed before this change.");
    // Organiser messages to ticket holders, with the way out.
    expect(section).toHaveTextContent("Organisers can also email the people holding tickets to their events through Sheltüh.");
    expect(section).toHaveTextContent("link to stop messages from that organiser");
    expect(within(section).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute(
      "href",
      "mailto:support@sheltuh.com.au",
    );
  });

  it("is pointed to from What we collect and Who we share it with, which no longer leave it at 'orders'", () => {
    render(<PrivacyPage />);
    for (const title of ["What we collect", "Who we share it with"]) {
      const section = screen.getByRole("heading", { name: title }).closest("section");
      if (!section) throw new Error(`${title} not rendered`);
      expect(within(section).getByRole("link", { name: "What organisers see" })).toHaveAttribute("href", "#organiser-orders");
    }
    expect(screen.getByRole("heading", { name: "What we collect" }).closest("section")).toHaveTextContent(
      "The name and email address you enter at checkout",
    );
  });
});

// Owner decision: usage analytics (PostHog, plus Vercel Web Analytics and Speed Insights).
describe("/privacy — Usage analytics", () => {
  it("is linkable as #analytics and says what is measured, what isn't, where it is kept and how to opt out", () => {
    render(<PrivacyPage />);
    const section = screen.getByRole("heading", { name: "Usage analytics" }).closest("section");
    if (!section) throw new Error("Usage analytics section not rendered");
    expect(section).toHaveAttribute("id", "analytics");
    expect(section).toHaveTextContent("PostHog");
    expect(section).toHaveTextContent("Vercel Web Analytics and Speed Insights");
    expect(section).toHaveTextContent("linked to a random account ID, not your name, email address or phone number");
    expect(section).toHaveTextContent("It doesn’t record your screen, what you type or the words you search for, and it sets no cookies");
    expect(section).toHaveTextContent("never an order number or ticket code");
    expect(section).toHaveTextContent("your cookies and the page you came from aren’t passed on");
    // IP address and user agent: what they are used for, and that PostHog doesn't keep the address.
    expect(section).toHaveTextContent("both tools receive your IP address and your browser’s user agent");
    expect(section).toHaveTextContent("estimate where you are, at country or city level");
    expect(section).toHaveTextContent("PostHog is set not to keep your IP address");
    expect(section).toHaveTextContent("links with a private code or token in them are never recorded");
    // The region is the owner's to set before go-live (app/privacy/page.tsx comment, docs/DEPLOYMENT.md).
    expect(section).toHaveTextContent("The data is kept by PostHog in the European Union.");
    expect(section).toHaveTextContent("We don’t use this for advertising, we don’t sell it, and it isn’t shared with ad networks.");
    expect(section).toHaveTextContent("Pages for Sheltüh’s own administrators aren’t measured.");
    expect(section).toHaveTextContent("utm_source=instagram");
    expect(section).toHaveTextContent("turn on Do Not Track or Global Privacy Control in your browser");
    expect(within(section).getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
  });

  it("is listed among the service providers", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "Who we share it with" }).closest("section")).toHaveTextContent(
      "payments, usage analytics and sending email",
    );
  });
});
