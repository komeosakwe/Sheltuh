// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import OAuthButtons from "@/components/auth/OAuthButtons";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { UA } from "./test-utils/user-agents";

vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const realUserAgent = window.navigator.userAgent;

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setUserAgent(realUserAgent);
});

function renderButtons({
  flag = "google,apple",
  next,
  auth = {},
}: { flag?: string; next?: string; auth?: Partial<AuthContextValue> } = {}) {
  vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
  const value = fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined, ...auth });
  const result = render(
    <FakeAuthProvider value={value}>
      <OAuthButtons next={next} />
    </FakeAuthProvider>,
  );
  return { ...result, auth: value };
}

const apple = () => screen.getByRole("button", { name: "Continue with Apple" });
const google = () => screen.getByRole("button", { name: "Continue with Google" });

/** A sign-in that never settles: the page would be on its way to the provider. */
const leaving = () => vi.fn(() => new Promise<void>(() => {}));

describe("OAuthButtons: which buttons render", () => {
  it("renders nothing with no provider listed, or in demo mode (Supabase not configured) even with one", () => {
    const { container } = renderButtons({ flag: "" });
    expect(container).toBeEmptyDOMElement();
    cleanup();

    const demo = renderButtons({ flag: "google,apple", auth: { configured: false } });
    expect(demo.container).toBeEmptyDOMElement();
  });

  it("renders Apple, then Google, whatever the flag's order, as real buttons named by their visible titles", () => {
    renderButtons({ flag: "google,apple" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Continue with Apple", "Continue with Google"]);
    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");
      expect(button.closest("form")).toBeNull();
      expect(button).not.toHaveAttribute("aria-disabled");
    }
  });

  it("shows only the flagged provider, and names only it in the legal line", () => {
    renderButtons({ flag: "google" });
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).toBeNull();
    expect(google()).toBeInTheDocument();
    expect(
      screen.getByText(/^Continuing with Google signs you in, or creates an account if you’re new\. How we handle your details:/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(screen.getByText("or")).toBeInTheDocument();
  });

  it("names both, Apple first, in the legal line when both are on", () => {
    renderButtons();
    expect(screen.getByText(/^Continuing with Apple or Google signs you in/)).toBeInTheDocument();
  });

  it("shows the owner's official logo files, hidden from assistive tech: Apple's white and black, Google's G", () => {
    renderButtons();
    const appleLogos = Array.from(apple().querySelectorAll("img"));
    expect(appleLogos.map((img) => img.getAttribute("src"))).toEqual(["/auth/apple-logo-white.svg", "/auth/apple-logo-black.svg"]);
    // One per theme: white on the White theme's black button, black on the Dark theme's white one.
    expect(appleLogos[0].className).toMatch(/\bdark:hidden\b/);
    expect(appleLogos[1].className).toMatch(/\bhidden\b.*\bdark:block\b/);
    const googleLogos = Array.from(google().querySelectorAll("img"));
    expect(googleLogos.map((img) => img.getAttribute("src"))).toEqual(["/auth/google-g.svg"]);
    for (const img of [...appleLogos, ...googleLogos]) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("OAuthButtons: starting a sign-in", () => {
  it("starts the provider's sign-in once with the safe next, and stays busy (both buttons) while the page leaves", () => {
    const signInWithProvider = leaving();
    renderButtons({ next: "/events/neon-static#whos-going", auth: { signInWithProvider } });

    google().focus();
    fireEvent.click(google());
    expect(signInWithProvider).toHaveBeenCalledTimes(1);
    expect(signInWithProvider).toHaveBeenCalledWith("google", "/events/neon-static#whos-going");

    expect(google()).toHaveAttribute("aria-disabled", "true");
    expect(apple()).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(google());
    expect(screen.getByRole("status")).toHaveTextContent("Opening Google…");

    fireEvent.click(google());
    fireEvent.click(apple());
    expect(signInWithProvider).toHaveBeenCalledTimes(1);
  });

  it("drops an unsafe next (another site, or an /auth page)", () => {
    const signInWithProvider = leaving();
    renderButtons({ next: "//evil.example", auth: { signInWithProvider } });
    fireEvent.click(apple());
    expect(signInWithProvider).toHaveBeenCalledWith("apple", undefined);
    cleanup();

    const again = leaving();
    renderButtons({ next: "/auth/callback?code=x", auth: { signInWithProvider: again } });
    fireEvent.click(apple());
    expect(again).toHaveBeenCalledWith("apple", undefined);
  });

  it("shows our own error when the sign-in can't start, and is usable again with focus kept on the button", async () => {
    const signInWithProvider = vi.fn().mockRejectedValue(new Error("TypeError: Failed to fetch <script>"));
    renderButtons({ auth: { signInWithProvider } });

    apple().focus();
    await act(async () => {
      fireEvent.click(apple());
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn’t open Apple sign-in. Check your connection and try again.",
    );
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
    expect(apple()).not.toHaveAttribute("aria-disabled");
    expect(google()).not.toHaveAttribute("aria-disabled");
    expect(document.activeElement).toBe(apple());
  });

  it("resets busy when Back restores the page from the back/forward cache, not on an ordinary pageshow", () => {
    renderButtons({ auth: { signInWithProvider: leaving() } });
    fireEvent.click(apple());
    expect(apple()).toHaveAttribute("aria-disabled", "true");

    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    });
    expect(apple()).toHaveAttribute("aria-disabled", "true");

    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(apple()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says what happens in a polite status and an alert that are always there (atomic), so they're read when filled", async () => {
    const signInWithProvider = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(leaving());
    renderButtons({ auth: { signInWithProvider } });
    const status = screen.getByRole("status");
    const alert = screen.getByRole("alert");
    for (const region of [status, alert]) {
      expect(region).toBeEmptyDOMElement();
      expect(region).toHaveAttribute("aria-atomic", "true");
    }

    await act(async () => {
      fireEvent.click(apple());
    });
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert).toHaveTextContent("Couldn’t open Apple sign-in.");
    expect(status).toBeEmptyDOMElement();

    // Trying again clears the error, and the same status region says it's opening.
    fireEvent.click(apple());
    expect(alert).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Opening Apple…");
  });
});

describe("OAuthButtons: inside an app's browser", () => {
  it("doesn't start Google in Instagram on iPhone: says to open Safari, or use Apple or email", async () => {
    setUserAgent(UA.iphoneInstagram);
    const signInWithProvider = leaving();
    renderButtons({ auth: { signInWithProvider } });

    google().focus();
    fireEvent.click(google());
    expect(signInWithProvider).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Google sign-in doesn’t work inside this app’s browser. Open this page in Safari, or continue with Apple or email.",
      ),
    );
    expect(document.activeElement).toBe(google());
    expect(google()).not.toHaveAttribute("aria-disabled");

    // Apple works there as usual.
    fireEvent.click(apple());
    expect(signInWithProvider).toHaveBeenCalledWith("apple", undefined);
  });

  it("suggests Chrome on Android, and only email when Apple isn't offered", async () => {
    setUserAgent(UA.androidInstagram);
    renderButtons({ flag: "google" });
    fireEvent.click(google());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Google sign-in doesn’t work inside this app’s browser. Open this page in Chrome, or continue with email.",
      ),
    );
  });

  it("says it again on each tap: the status is emptied, then filled a moment later", () => {
    vi.useFakeTimers();
    try {
      setUserAgent(UA.iphoneInstagram);
      renderButtons();
      const status = screen.getByRole("status");
      fireEvent.click(google());
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(status).toHaveTextContent(/doesn’t work inside this app’s browser/);

      fireEvent.click(google());
      expect(status).toBeEmptyDOMElement();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(status).toHaveTextContent(/doesn’t work inside this app’s browser/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts Google as usual in a real browser (Chrome on iPhone)", () => {
    setUserAgent(UA.iphoneChrome);
    const signInWithProvider = leaving();
    renderButtons({ auth: { signInWithProvider } });
    fireEvent.click(google());
    expect(signInWithProvider).toHaveBeenCalledWith("google", undefined);
  });
});

describe("OAuthButtons on /login and /signup", () => {
  async function renderPage(page: "login" | "signup", next?: string, flag = "google,apple") {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", flag);
    const signInWithProvider = leaving();
    const searchParams = Promise.resolve(next ? { next } : {});
    const element =
      page === "login"
        ? await LoginPage({ searchParams } as PageProps<"/login">)
        : await SignupPage({ searchParams } as PageProps<"/signup">);
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", signInWithProvider })}>{element}</FakeAuthProvider>,
    );
    return signInWithProvider;
  }

  it.each(["login", "signup"] as const)("/%s: the buttons, their line and the divider come before the email form, carrying ?next=", async (page) => {
    const signInWithProvider = await renderPage(page, "/events/neon-static");
    const appleButton = apple();
    const email = screen.getByLabelText("Email");
    const divider = screen.getByText("or");
    expect(appleButton.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The callback's "Use email instead" lands on the email form's wrapper, label and all.
    if (page === "login") expect(email.closest("#email-sign-in")).not.toBeNull();

    fireEvent.click(google());
    expect(signInWithProvider).toHaveBeenCalledWith("google", "/events/neon-static");
  });

  it("/login says the privacy line once: the buttons' line with them, the one under the form without", async () => {
    await renderPage("login");
    expect(screen.getAllByRole("link", { name: "Privacy Policy" })).toHaveLength(1);
    expect(screen.getByText(/^Continuing with Apple or Google signs you in/)).toBeInTheDocument();
    cleanup();

    await renderPage("login", undefined, "");
    expect(screen.getAllByRole("link", { name: "Privacy Policy" })).toHaveLength(1);
    expect(screen.getByText(/^How we handle your details:/)).toBeInTheDocument();
  });
});

describe("OAuthButtons in forced colours (Windows contrast themes)", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

  it("gives Apple's borderless button an edge in the system's button text colour; Google's keeps its own 1px stroke", () => {
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.btn-oauth-apple \{\s*border: 1px solid ButtonText;/);
    expect(css).toMatch(/\.btn-oauth-google \{[^}]*border: 1px solid var\(--google-stroke\);/);
  });
});
