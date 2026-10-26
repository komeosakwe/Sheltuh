// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace, push: vi.fn() }) }));

let organiser: { status: string } | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser, error: null, refetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  organiser = null;
  routerReplace.mockClear();
});

describe("ApplyPageContent signed out", () => {
  it("sends Sign in and Sign up back to the application afterwards (email, Apple or Google alike)", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined })}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(screen.getByText("Sign in or create an account to apply as an organiser.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Forganisers%2Fapply");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup?next=%2Forganisers%2Fapply");
  });
});

describe("ApplyPageContent for an existing organiser", () => {
  // Owner (26 Oct 2026): "if someone is already an organiser clicking for organiser should take them to the dashboard".
  it("sends an approved organiser straight to their dashboard", () => {
    organiser = { status: "approved" };
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(routerReplace).toHaveBeenCalledWith("/dashboard");
    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("leaves a pending applicant on their status, not the dashboard", () => {
    organiser = { status: "pending" };
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(screen.getByText("Application pending")).toBeInTheDocument();
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
