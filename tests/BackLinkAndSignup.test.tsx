// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignupPage from "@/app/signup/page";
import BackLink from "@/components/ui/BackLink";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/signup",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

describe("BackLink (the site's one back link, mobile-redesign.md §3.2)", () => {
  it("is Instrument, not mono: 14/20 semibold, underlined, 44px to tap; the arrow is decorative", () => {
    render(<BackLink href="/">Back to all events</BackLink>);
    const link = screen.getByRole("link", { name: "Back to all events" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveClass("text-sm", "leading-5", "font-semibold", "underline", "min-h-11");
    expect(link).not.toHaveClass("eyebrow");
    expect(link.querySelector("[aria-hidden='true']")).toHaveTextContent("←");
  });
});

describe("/signup intro (A1: says what an account is really for)", () => {
  it("names what an account unlocks, and that browsing and buying tickets need none", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", configured: true })}>
        {await SignupPage({ searchParams: Promise.resolve({}) } as PageProps<"/signup">)}
      </FakeAuthProvider>,
    );
    const intro = screen.getByText(/^An account lets you/);
    expect(intro).toHaveTextContent(
      "An account lets you add yourself to an event’s Who’s Going list, see who else is going, message people going to the same event, and apply as an organiser. You don’t need one to browse events or buy tickets.",
    );
    // No longer "only for organisers", and no "(later)": checkout is guest checkout today.
    expect(intro).not.toHaveTextContent(/later/);
  });
});
