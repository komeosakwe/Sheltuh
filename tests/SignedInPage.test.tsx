// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SignedInPage, { metadata } from "@/app/signed-in/page";
import { oauthReturnPath } from "@/lib/auth/oauth";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

afterEach(cleanup);

describe("/signed-in (where InlineReauth's new-tab sign-in ends)", () => {
  it("says to go back to the other tab, and isn't indexed", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <SignedInPage />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "You’re signed in" })).toBeInTheDocument();
    expect(screen.getByText("Go back to your other tab to finish. You can close this one.")).toBeInTheDocument();
    expect(metadata.title).toBe("Signed in — Sheltüh");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("says so honestly if someone lands on it signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined })}>
        <SignedInPage />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "You’re not signed in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fsigned-in");
  });

  it("is a return path a Google or Apple sign-in may carry (unlike anything under /auth)", () => {
    expect(oauthReturnPath("/signed-in")).toBe("/signed-in");
  });
});
