// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "@/app/forgot-password/page";
import HelpPage from "@/app/help/page";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import VerifyPage from "@/app/verify/page";
import { AUTH_PHOTO } from "@/components/auth/AuthShell";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * The account pages in the redesign's sign-in frame (PR 6; the owner's sign-in mock): a licensed
 * photo with the page's own colour as a card on it, and in the card the wordmark, "Account", the
 * h1 and the page's own content. Sign-in's behaviour is tested in LoginForm, AuthForms,
 * AuthReturnPath and OAuthButtons; this is its anatomy.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const signedOut: Partial<AuthContextValue> = { status: "signed-out", email: undefined, accessToken: undefined };

async function renderLogin({ flag = "google,apple", auth = {} }: { flag?: string; auth?: Partial<AuthContextValue> } = {}) {
  vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
  const element = await LoginPage({ searchParams: Promise.resolve({}) } as PageProps<"/login">);
  return render(<FakeAuthProvider value={fakeAuthValue({ ...signedOut, ...auth })}>{element}</FakeAuthProvider>);
}

const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The backdrop photo's path (next/image wraps it in /_next/image?url=…). */
const photoSrc = (container: HTMLElement) => decodeURIComponent(container.querySelector("img")?.getAttribute("src") ?? "");

describe("/login (the sign-in mock)", () => {
  it("the mock's copy: the wordmark, Account, Welcome to Sheltüh and its line", async () => {
    const { container } = await renderLogin();
    const h1 = screen.getByRole("heading", { level: 1, name: "Welcome to Sheltüh" });
    expect(screen.getByText("Find your place, find your people.")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    // The wordmark is decorative: the h1 names the page.
    const wordmark = container.querySelector("svg[aria-hidden='true']");
    expect(wordmark).not.toBeNull();
    expect(follows(wordmark as Element, h1)).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("in the mock's order: email, Continue, Or continue with, the buttons, their line, then Create an account and Find my tickets", async () => {
    await renderLogin();
    const order = [
      screen.getByRole("heading", { level: 1 }),
      screen.getByLabelText("Email"),
      screen.getByRole("button", { name: "Continue" }),
      screen.getByText("Or continue with"),
      screen.getByRole("button", { name: "Continue with Apple" }),
      screen.getByRole("button", { name: "Continue with Google" }),
      screen.getByText(/^Continuing with Apple or Google signs you in/),
      screen.getByRole("link", { name: "Create an account" }),
      screen.getByRole("link", { name: "Find my tickets" }),
    ];
    for (let i = 1; i < order.length; i++) expect(follows(order[i - 1], order[i])).toBe(true);
    expect(screen.getByText(/^New here\?/)).toContainElement(screen.getByRole("link", { name: "Create an account" }));
  });

  it("keeps the vendors' own titles (never a bare Google or Apple) and the email placeholder", async () => {
    await renderLogin();
    expect(screen.queryByRole("button", { name: "Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apple" })).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "you@example.com");
  });

  it("the h1 is heading-xl (40/48, 56/64 from 1024px)", async () => {
    await renderLogin();
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("heading-xl");
  });

  it("Continue is the page's one orange action, its arrow decorative", async () => {
    const { container } = await renderLogin();
    const submit = screen.getByRole("button", { name: "Continue" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveClass("btn-signal");
    expect(submit.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".btn-signal")).toHaveLength(1);
  });

  it("the backdrop is the licensed photo, decorative, never the proposal's people photos", async () => {
    const { container } = await renderLogin();
    expect(photoSrc(container)).toContain(AUTH_PHOTO);
    expect(AUTH_PHOTO).toMatch(/^\/events\//);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("in the demo: no buttons, the email form's own notice and privacy line, Find my tickets but no Create an account", async () => {
    await renderLogin({ auth: { configured: false } });
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(screen.queryByRole("button", { name: /Continue with/ })).toBeNull();
    expect(screen.queryByText("Or continue with")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Privacy Policy" })).toHaveLength(1);
    // No accounts in the demo: nothing to create, but tickets can still be found.
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    expect(screen.queryByText(/New here\?/)).toBeNull();
    expect(screen.getByRole("link", { name: "Find my tickets" })).toBeInTheDocument();
  });
});

describe("the other account pages share the frame", () => {
  it.each([
    ["/signup", "Create an account", () => SignupPage({ searchParams: Promise.resolve({}) } as PageProps<"/signup">)],
    [
      "/forgot-password",
      "Reset your password",
      () => ForgotPasswordPage({ searchParams: Promise.resolve({}) } as PageProps<"/forgot-password">),
    ],
    ["/verify", "Verify your email", () => VerifyPage()],
  ] as const)("%s: the photo, Account and its own h1", async (_path, title, page) => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue(signedOut)}>{await page()}</FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(photoSrc(container)).toContain(AUTH_PHOTO);
  });

  it("/signup's Sign up is the same orange M button as /login's Continue", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    render(
      <FakeAuthProvider value={fakeAuthValue(signedOut)}>
        {await SignupPage({ searchParams: Promise.resolve({}) } as PageProps<"/signup">)}
      </FakeAuthProvider>,
    );
    const submit = screen.getByRole("button", { name: "Sign up" });
    expect(submit).toHaveClass("btn", "btn-signal");
    expect(submit).not.toHaveClass("btn-lg");
  });
});

describe("Find my tickets' destination", () => {
  it("Help's Where are my tickets? has the anchor", () => {
    const { container } = render(<HelpPage />);
    const section = container.querySelector("#where-are-my-tickets");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByRole("heading", { level: 2 })).toHaveTextContent("Where are my tickets?");
  });
});
