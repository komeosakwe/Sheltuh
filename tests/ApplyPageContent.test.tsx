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
  it("sends Sign in and Create an account back to the application afterwards (email, Apple or Google alike)", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined })}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    // The Start organising panel's h2 (the panel is labelled by its id).
    const title = screen.getByRole("heading", { level: 2, name: "Sign in to apply as an organiser." });
    expect(title).toHaveAttribute("id", "start-title");
    expect(screen.getByText("Takes about five minutes.")).toBeInTheDocument();
    // There's no draft to come back to (plan §7).
    expect(screen.queryByText(/save and finish later/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Forganisers%2Fapply");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup?next=%2Forganisers%2Fapply");
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
    expect(screen.getByRole("heading", { level: 2, name: "You’re an approved organiser" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("leaves a pending applicant on their status, not the dashboard", () => {
    organiser = { status: "pending" };
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Application pending" })).toHaveAttribute("id", "start-title");
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe("ApplyPageContent, signed in with no application", () => {
  it("shows the form under the panel's h2", () => {
    organiser = null;
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Become an organiser" })).toHaveAttribute("id", "start-title");
    expect(screen.getByLabelText("Organiser name")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

describe("ApplyPageContent in the demo (no accounts)", () => {
  it("says accounts aren't configured, under the panel's h2", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
        <ApplyPageContent />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "start-title");
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
  });
});
