// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApplyPageContent from "@/components/organisers/ApplyPageContent";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: null, error: null, refetch: vi.fn() }),
}));

afterEach(cleanup);

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
