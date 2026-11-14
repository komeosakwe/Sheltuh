// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import OAuthButtons, { BUSY_RETURN_GRACE_MS, BUSY_TIMEOUT_MS } from "@/components/auth/OAuthButtons";
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

  it("shows the official artwork, hidden from assistive tech: Apple's white and black logos, Google's G", () => {
    renderButtons();
    const appleLogos = Array.from(apple().querySelectorAll("img"));
    expect(appleLogos.map((img) => img.getAttribute("src"))).toEqual(["/auth/apple-logo-white.svg", "/auth/apple-logo-black.svg"]);
    // One per theme: white on the White theme's black button, black on the Dark theme's white one.
    expect(appleLogos[0].className).toMatch(/\bdark:hidden\b/);
    expect(appleLogos[1].className).toMatch(/\bhidden\b.*\bdark:block\b/);
    // Google's G: one multi-colour file on both themes, at 20px, beside the title as real text.
    const googleImages = Array.from(google().querySelectorAll("img"));
    expect(googleImages.map((img) => img.getAttribute("src"))).toEqual(["/auth/google-g.svg"]);
    expect(googleImages[0].className).toMatch(/\bsize-6\b/);
    for (const img of [...appleLogos, ...googleImages]) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
    // Its name is its visible title (label in name), as text in the button, not an image or sr-only.
    expect(google()).toHaveTextContent(/^Continue with Google$/);
    expect(google().querySelector("span")).not.toHaveClass("sr-only");
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

  it("unlocks when the page comes back without leaving (a closed Apple sheet), but not on the tap's own focus", () => {
    vi.useFakeTimers();
    try {
      renderButtons({ auth: { signInWithProvider: leaving() } });
      fireEvent.click(apple());
      expect(apple()).toHaveAttribute("aria-disabled", "true");
      // The tap's own focus, straight away: still busy.
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(apple()).toHaveAttribute("aria-disabled", "true");
      // Back in front after the sheet closes.
      act(() => {
        vi.advanceTimersByTime(BUSY_RETURN_GRACE_MS + 10);
        window.dispatchEvent(new Event("focus"));
      });
      expect(apple()).not.toHaveAttribute("aria-disabled");
      expect(google()).not.toHaveAttribute("aria-disabled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a sign-in that fails late, after the buttons unlocked and another started, leaves the newer one alone", async () => {
    vi.useFakeTimers();
    try {
      let rejectFirst: (err: Error) => void = () => {};
      const signInWithProvider = vi
        .fn()
        .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)))
        .mockImplementation(leaving());
      renderButtons({ auth: { signInWithProvider } });
      fireEvent.click(apple());
      act(() => {
        vi.advanceTimersByTime(BUSY_RETURN_GRACE_MS + 10);
        window.dispatchEvent(new Event("focus"));
      });
      fireEvent.click(google());
      expect(google()).toHaveAttribute("aria-disabled", "true");
      await act(async () => {
        rejectFirst(new Error("late"));
        await Promise.resolve();
      });
      expect(google()).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks after the time-out even with no focus or visibility event", () => {
    vi.useFakeTimers();
    try {
      renderButtons({ auth: { signInWithProvider: leaving() } });
      fireEvent.click(google());
      expect(google()).toHaveAttribute("aria-disabled", "true");
      act(() => {
        vi.advanceTimersByTime(BUSY_TIMEOUT_MS);
      });
      expect(google()).not.toHaveAttribute("aria-disabled");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
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

  it("/signup: the buttons, their line and the divider come before the email form, carrying ?next=", async () => {
    const signInWithProvider = await renderPage("signup", "/events/neon-static");
    const appleButton = apple();
    const email = screen.getByLabelText("Email");
    const divider = screen.getByText("or");
    expect(appleButton.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(google());
    expect(signInWithProvider).toHaveBeenCalledWith("google", "/events/neon-static");
  });

  it("/login (the sign-in mock): the email form and Continue, then \"Or continue with\", the buttons and their line, carrying ?next=", async () => {
    const signInWithProvider = await renderPage("login", "/events/neon-static");
    const email = screen.getByLabelText("Email");
    const submit = screen.getByRole("button", { name: "Continue" });
    const divider = screen.getByText("Or continue with");
    const appleButton = apple();
    const line = screen.getByText(/^Continuing with Apple or Google signs you in/);
    for (const [before, after] of [
      [email, submit],
      [submit, divider],
      [divider, appleButton],
      [appleButton, google()],
      [google(), line],
    ]) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The buttons are outside the email form: they never submit it.
    expect(appleButton.closest("form")).toBeNull();
    expect(google().closest("form")).toBeNull();
    // The callback's "Use email instead" lands on the email form's wrapper, label and all.
    expect(email.closest("#email-sign-in")).not.toBeNull();
    expect(screen.queryByText("or")).toBeNull();

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

  it("gives Apple's borderless button an edge in the system's button text colour; Google's has its own 1px border", () => {
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.btn-oauth-apple \{\s*border: 1px solid ButtonText;/);
    expect(rule(css, ".btn-oauth-google")).toMatch(/border: 1px solid var\(--google-stroke\);/);
  });
});

function rule(css: string, selector: string): string {
  return css.match(new RegExp(`${selector.replace(/[.:]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
}

describe("OAuthButtons: Google's button matches Apple's, with Google's own parts (app/globals.css)", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

  it("has Apple's size, shape, title size and layout (owner, 13 Nov), with Google's 1px stroke, fill, title colour and Roboto Medium", () => {
    const google = rule(css, ".btn-oauth-google");
    const apple = rule(css, ".btn-oauth-apple");
    for (const shared of [/padding-inline: 0 8%;/, /font-size: calc\(3rem \* 0\.43\);/, /line-height: 1;/]) {
      expect(google).toMatch(shared);
      expect(apple).toMatch(shared);
    }
    // Full width, 48px and the control radius come from .btn-oauth, which Google's no longer overrides.
    expect(google).not.toMatch(/(^|\s)(width|height|min-height|border-radius|align-self):/);
    expect(rule(css, ".btn-oauth")).toMatch(/width: 100%;[\s\S]*min-height: 3rem;[\s\S]*border-radius: var\(--radius-control\);/);
    expect(google).toMatch(/border: 1px solid var\(--google-stroke\);/);
    expect(google).toMatch(/background: var\(--google-fill\);/);
    expect(google).toMatch(/color: var\(--google-text\);/);
    expect(rule(css, ".btn-oauth")).toMatch(/font-weight: 500;/);
    expect(css).not.toMatch(/\.btn-oauth-google::before/);
  });

  it("takes Light on the White theme and Dark on the Dark theme, at Google's values", () => {
    expect(css).toMatch(/--google-fill: #ffffff;\s*--google-stroke: #747775;\s*--google-text: #1f1f1f;/);
    expect(css).toMatch(/--google-fill: #131314;\s*--google-stroke: #8e918f;\s*--google-text: #e3e3e3;/);
  });
});

