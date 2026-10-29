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

describe("/signup header", () => {
  it("is just the heading: no paragraph on what an account unlocks", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", configured: true })}>
        {await SignupPage({ searchParams: Promise.resolve({}) } as PageProps<"/signup">)}
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Create an account" })).toBeInTheDocument();
    expect(screen.queryByText(/An account lets you/)).toBeNull();
  });
});
