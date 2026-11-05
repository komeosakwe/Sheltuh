// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventHost from "@/components/events/EventHost";
import OrganiserLinkIcon from "@/components/organisers/OrganiserLinkIcon";
import { SOCIAL_NETWORKS } from "@/lib/organiser-profile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

afterEach(cleanup);

function sampleEvent(organiserName: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.organiserName === organiserName);
  if (!event) throw new Error(`No sample event for ${organiserName}`);
  return event;
}

/** A live event: has an organiserId, and whatever the API sent for the Host card. */
function liveEvent(extra: Partial<SheltuhEvent> = {}): SheltuhEvent {
  return { ...sampleEvent("Static Collective"), organiserId: "org-live", organiserName: "Northside Noise", ...extra };
}

function renderHost(event: SheltuhEvent, demo: boolean) {
  render(<EventHost event={event} demo={demo} />);
  return screen.getByRole("region", { name: "Host" });
}

describe("EventHost, in the demo", () => {
  it("looks the sample organiser up by name: all eight networks and the website, with the bio", () => {
    const host = renderHost(sampleEvent("Static Collective"), true);
    const links = within(host).getAllByRole("link");
    // View profile, Website, and the eight networks.
    expect(links).toHaveLength(10);
    expect(within(host).getByRole("link", { name: /^View profile/ })).toHaveAttribute("href", "/organisers/static-collective");
    expect(within(host).getByRole("link", { name: "Website: staticcollective.example (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://staticcollective.example",
    );
    for (const { label } of SOCIAL_NETWORKS) {
      expect(within(host).getByRole("link", { name: new RegExp(`^${label}.*\\(opens in a new tab\\)$`) })).toBeInTheDocument();
    }
    expect(within(host).getByText(/Static Collective is a fictional organiser/)).toBeInTheDocument();
  });

  it("opens links in a new tab: the website is nofollow ugc, social links are not", () => {
    const host = renderHost(sampleEvent("Static Collective"), true);
    const site = within(host).getByRole("link", { name: /^Website/ });
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    const instagram = within(host).getByRole("link", { name: /^Instagram/ });
    expect(instagram).toHaveAttribute("target", "_blank");
    expect(instagram).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("lays the links out one to a row on phones and two from 640px", () => {
    const host = renderHost(sampleEvent("Static Collective"), true);
    const list = within(host).getAllByRole("list")[0];
    expect(list).toHaveClass("grid-cols-1", "sm:grid-cols-2");
  });

  it("names the host and the View profile link for screen readers", () => {
    const host = renderHost(sampleEvent("Static Collective"), true);
    expect(within(host).getByText("Static Collective")).toBeInTheDocument();
    expect(within(host).getByRole("link", { name: "View profile of Static Collective" })).toBeInTheDocument();
  });

  it("shows only the links the sample organiser has", () => {
    const host = renderHost(sampleEvent("Paper Moon Studio"), true);
    expect(within(host).getByRole("link", { name: /^Instagram/ })).toBeInTheDocument();
    expect(within(host).getByRole("link", { name: /^LinkedIn/ })).toBeInTheDocument();
    expect(within(host).queryByRole("link", { name: /^(TikTok|Spotify|SoundCloud|YouTube|Facebook|X|Website)/ })).toBeNull();
  });
});

describe("EventHost, live", () => {
  it("shows what the event carries: website, links and the bio excerpt", () => {
    const host = renderHost(
      liveEvent({
        organiserWebsiteUrl: "https://northside.example/",
        organiserSocialLinks: { instagram: "https://www.instagram.com/northside.noise/", spotify: "https://open.spotify.com/artist/abc123" },
        organiserBio: "Loud nights in small rooms…",
      }),
      false,
    );
    expect(within(host).getByRole("link", { name: /^View profile/ })).toHaveAttribute("href", "/organisers/org-live");
    expect(within(host).getByRole("link", { name: "Website: northside.example (opens in a new tab)" })).toBeInTheDocument();
    expect(within(host).getByRole("link", { name: "Instagram: @northside.noise (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/northside.noise/",
    );
    expect(within(host).getByRole("link", { name: /^Spotify/ })).toBeInTheDocument();
    expect(within(host).getByText("Loud nights in small rooms…")).toBeInTheDocument();
    expect(within(host).getAllByRole("link")).toHaveLength(4);
  });

  it("does not borrow a sample organiser's links for a live event with the same name", () => {
    const host = renderHost(liveEvent({ organiserName: "Static Collective" }), false);
    expect(within(host).queryByRole("list")).toBeNull();
    expect(within(host).queryByText(/fictional organiser/)).toBeNull();
  });

  it("with no links or bio, is just the name and View profile", () => {
    const host = renderHost(liveEvent(), false);
    expect(within(host).getByText("Northside Noise")).toBeInTheDocument();
    expect(within(host).getAllByRole("link")).toHaveLength(1);
    expect(within(host).getByRole("link", { name: "View profile of Northside Noise" })).toBeInTheDocument();
    expect(within(host).queryByRole("list")).toBeNull();
    expect(host.querySelector("p:not(:first-child)")).toBeNull();
  });

  it("shows the logo when the event has one, and initials otherwise", () => {
    const withLogo = renderHost(liveEvent({ organiserLogoThumbUrl: "/api/organisers/org-live/logo?size=thumb&v=1" }), false);
    expect(withLogo.querySelector("[data-organiser-logo] img")).toHaveAttribute("src", "/api/organisers/org-live/logo?size=thumb&v=1");
    cleanup();
    const withoutLogo = renderHost(liveEvent(), false);
    expect(withoutLogo.querySelector("[data-organiser-logo]")).toBeNull();
    expect(within(withoutLogo).getByText("NN")).toBeInTheDocument();
  });
});

describe("OrganiserLinkIcon", () => {
  it.each(["spotify", "soundcloud", "youtube", "linkedin"] as const)("draws a decorative %s mark", (kind) => {
    const { container } = render(<OrganiserLinkIcon kind={kind} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.querySelector("path, circle, rect")).not.toBeNull();
  });

  it("draws a different mark for every kind", () => {
    const kinds = [...SOCIAL_NETWORKS.map((n) => n.network), "website" as const];
    const marks = kinds.map((kind) => {
      const { container, unmount } = render(<OrganiserLinkIcon kind={kind} />);
      const html = container.querySelector("svg")?.innerHTML ?? "";
      unmount();
      return html;
    });
    expect(marks.every(Boolean)).toBe(true);
    expect(new Set(marks).size).toBe(kinds.length);
  });
});
