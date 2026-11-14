// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import InlineReauth from "@/components/auth/InlineReauth";
import LoginForm from "@/components/auth/LoginForm";
import SignupForm from "@/components/auth/SignupForm";
import VerifyForm from "@/components/auth/VerifyForm";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import {
  HUMAN_CHECK_FAILED,
  HumanCheckError,
  TURNSTILE_PRIVACY_URL,
  TURNSTILE_SCRIPT_URL,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from "@/lib/auth/turnstile";
import { HUMAN_CHECK_WAIT_MS } from "@/lib/auth/useHumanCheck";
import { applyTheme } from "@/lib/theme";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/*
 * Cloudflare Turnstile on the email auth forms (lib/auth/useHumanCheck.ts,
 * components/auth/HumanCheckField.tsx): with no site key nothing is loaded or
 * shown and Supabase is called without a token; with one, Cloudflare's script
 * is requested once, the widget's token goes into the Supabase call, the
 * widget is reset after every attempt, and its problems are said.
 * Cloudflare's script is never fetched here (jsdom doesn't load scripts): a
 * fake `window.turnstile` stands in once the test fires the script's load.
 */

const SITE_KEY = "1x00000000000000000000AA";

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

interface Widget {
  id: string;
  container: HTMLElement;
  options: TurnstileRenderOptions;
}

function fakeTurnstile() {
  const widgets: Widget[] = [];
  const api = {
    render: vi.fn((container: HTMLElement, options: TurnstileRenderOptions) => {
      const id = `widget-${widgets.length + 1}`;
      widgets.push({ id, container, options });
      return id;
    }),
    reset: vi.fn<(id: string) => void>(),
    remove: vi.fn<(id: string) => void>(),
  } satisfies TurnstileApi;
  const last = (): Widget => {
    const widget = widgets.at(-1);
    if (!widget) throw new Error("no widget rendered");
    return widget;
  };
  return {
    api,
    widgets,
    last,
    /** Cloudflare answers: a token, through the last widget's callback. */
    pass(token: string) {
      act(() => last().options.callback?.(token));
    },
  };
}

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script")].filter((s) => s.src.startsWith("https://challenges.cloudflare.com/"));
}

/** Cloudflare's script loads: `window.turnstile` appears and the script's load event fires. */
async function loadScript(api: TurnstileApi) {
  const [script] = scripts();
  if (!script) throw new Error("Turnstile's script wasn't requested");
  window.turnstile = api;
  await act(async () => {
    script.dispatchEvent(new Event("load"));
  });
}

function renderWith(ui: ReactElement, overrides: Partial<AuthContextValue> = {}) {
  const auth = fakeAuthValue({ status: "signed-out", ...overrides });
  render(<FakeAuthProvider value={auth}>{ui}</FakeAuthProvider>);
  return auth;
}

function fillLogin() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
}

/** The human check's own status line (beside its widget). */
function status(): HTMLElement {
  const line = screen.getByRole("group", { name: "Human check (Cloudflare Turnstile)" }).parentElement?.querySelector<HTMLElement>("[role=status]");
  if (!line) throw new Error("no human check status line");
  return line;
}

beforeEach(() => {
  applyTheme("light");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, "turnstile");
  for (const script of scripts()) script.remove();
  push.mockReset();
  searchParams = new URLSearchParams();
  applyTheme("light");
});

describe("Turnstile off (no NEXT_PUBLIC_TURNSTILE_SITE_KEY)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", ""));

  it.each([
    ["sign-in", () => <LoginForm />],
    ["sign-up", () => <SignupForm />],
    ["password reset", () => <ForgotPasswordForm />],
    ["verify", () => <VerifyForm />],
    ["inline sign-in", () => <InlineReauth onSignedIn={() => {}} />],
  ])("%s: no widget, no Cloudflare line, no script", (_name, ui) => {
    renderWith(ui());
    expect(screen.queryByRole("group", { name: /human check/i })).toBeNull();
    expect(screen.queryByText(/Cloudflare/)).toBeNull();
    expect(scripts()).toEqual([]);
  });

  it("a whitespace-only key is off too", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "   ");
    renderWith(<LoginForm />);
    expect(scripts()).toEqual([]);
  });

  it("the sign-in is sent at once, with no token", async () => {
    const auth = renderWith(<LoginForm />);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", undefined);
  });

  it("demo mode (Supabase not configured) with a key: still nothing loaded", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", SITE_KEY);
    renderWith(<LoginForm />, { configured: false });
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured");
    expect(scripts()).toEqual([]);
  });
});

describe("Turnstile on", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", SITE_KEY));

  it("requests Cloudflare's script once, in explicit render mode, and renders a managed, interaction-only widget", async () => {
    const turnstile = fakeTurnstile();
    renderWith(
      <>
        <LoginForm />
        <InlineReauth onSignedIn={() => {}} />
      </>,
    );
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toBe(TURNSTILE_SCRIPT_URL);
    expect(TURNSTILE_SCRIPT_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    await loadScript(turnstile.api);

    expect(turnstile.api.render).toHaveBeenCalledTimes(2);
    const [login, reauth] = turnstile.widgets;
    expect(login.options).toMatchObject({
      sitekey: SITE_KEY,
      action: "sign-in",
      theme: "light",
      appearance: "interaction-only",
      "refresh-expired": "auto",
      "response-field": false,
    });
    expect(reauth.options.action).toBe("reauth");
    // jsdom lays nothing out (0px wide): narrower than Turnstile's 300px minimum, so compact.
    expect(login.options.size).toBe("compact");
    // Rendered into the labelled container.
    const groups = screen.getAllByRole("group", { name: "Human check (Cloudflare Turnstile)" });
    expect(groups).toContain(login.container);
    // Re-rendering doesn't ask for it again.
    fireEvent.change(screen.getAllByLabelText("Email")[0], { target: { value: "x" } });
    expect(scripts()).toHaveLength(1);
  });

  it("says who runs the check and links Cloudflare's privacy notice in a new tab", () => {
    renderWith(<SignupForm />);
    const link = screen.getByRole("link", { name: /Cloudflare privacy/ });
    expect(link).toHaveAttribute("href", TURNSTILE_PRIVACY_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/^Cloudflare privacy\s*\(opens in a new tab\)$/);
    expect(screen.getByText(/Protected by Cloudflare Turnstile/)).toBeInTheDocument();
  });

  it("follows the site's Dark theme, and renders again when the theme changes", async () => {
    applyTheme("dark");
    const turnstile = fakeTurnstile();
    renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    expect(turnstile.last().options.theme).toBe("dark");
    act(() => applyTheme("light"));
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(2));
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
    expect(turnstile.last().options.theme).toBe("light");
  });

  it("sign-in: the token goes to Supabase, and the widget is reset after it worked", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    turnstile.pass("token-1");
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", "token-1");
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("a refused sign-in also resets the widget, and the next attempt waits for a fresh token", async () => {
    const turnstile = fakeTurnstile();
    const signIn = vi.fn().mockRejectedValueOnce(new Error("Invalid login credentials")).mockResolvedValue(undefined);
    renderWith(<LoginForm />, { signIn });
    await loadScript(turnstile.api);
    turnstile.pass("token-1");
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1);

    // The used token isn't sent again: the submit waits for the next one.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Checking you’re human…")).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledTimes(1);
    turnstile.pass("token-2");
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(signIn).toHaveBeenLastCalledWith("mia@example.com", "correct horse", "token-2");
    expect(turnstile.api.reset).toHaveBeenCalledTimes(2);
  });

  it("a submit before Cloudflare has answered says it's checking, then goes on by itself", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(status()).toHaveTextContent("Checking you’re human…"));
    expect(screen.getByRole("button", { name: "Signing in…" })).toHaveAttribute("aria-disabled", "true");
    expect(auth.signIn).not.toHaveBeenCalled();
    turnstile.pass("token-late");
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", "token-late"));
    expect(status()).toBeEmptyDOMElement();
  });

  it("while the widget asks for a tap, says so and waits past the usual deadline", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    act(() => turnstile.last().options["before-interactive-callback"]?.());
    await waitFor(() => expect(status()).toHaveTextContent("Complete the Cloudflare check to continue."));
    await act(async () => {
      vi.advanceTimersByTime(HUMAN_CHECK_WAIT_MS * 3);
    });
    expect(auth.signIn).not.toHaveBeenCalled();
    act(() => turnstile.last().options["after-interactive-callback"]?.());
    turnstile.pass("token-tapped");
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", "token-tapped"));
  });

  it("no token in time: sent without one (Supabase decides), and the widget is reset", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => {
      vi.advanceTimersByTime(HUMAN_CHECK_WAIT_MS - 100);
    });
    expect(auth.signIn).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", undefined));
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("an expired token isn't sent: the submit waits for Turnstile's refreshed one", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    turnstile.pass("token-old");
    act(() => turnstile.last().options["expired-callback"]?.());
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(status()).toHaveTextContent("Checking you’re human…"));
    turnstile.pass("token-new");
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", "token-new"));
  });

  it("a widget error is said (aria-live), and the next submit retries the check", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    let handled: boolean | void = false;
    act(() => {
      handled = turnstile.last().options["error-callback"]?.("300010");
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(status()).toHaveTextContent(HUMAN_CHECK_FAILED));
    expect(status()).toHaveClass("text-danger");

    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // Retried at once, and waiting for the new token.
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
    await waitFor(() => expect(status()).toHaveTextContent("Checking you’re human…"));
    turnstile.pass("token-retry");
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", "token-retry"));
  });

  it("an error while a submit waits ends the wait: sent without a token", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(status()).toHaveTextContent("Checking you’re human…"));
    act(() => {
      turnstile.last().options["timeout-callback"]?.();
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", undefined));
  });

  it("the script can't load: said, and a submit tries loading it again, then goes on without a token", async () => {
    const auth = renderWith(<LoginForm />);
    const [script] = scripts();
    await act(async () => {
      script.dispatchEvent(new Event("error"));
    });
    await waitFor(() => expect(status()).toHaveTextContent("Couldn’t load the human check."));
    expect(scripts()).toEqual([]);

    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(scripts()).toHaveLength(1));
    await act(async () => {
      scripts()[0].dispatchEvent(new Event("error"));
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", undefined));
  });

  it("an unsupported browser is told so, and the submit isn't held up", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    act(() => turnstile.last().options["unsupported-callback"]?.());
    await waitFor(() => expect(status()).toHaveTextContent("This browser can’t run the human check."));
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("mia@example.com", "correct horse", undefined));
  });

  it("Supabase refusing the token: friendly copy, no field marked, the widget reset", async () => {
    const turnstile = fakeTurnstile();
    renderWith(<LoginForm />, { signIn: vi.fn().mockRejectedValue(new HumanCheckError()) });
    await loadScript(turnstile.api);
    turnstile.pass("token-1");
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t confirm you’re human. Try again.");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("an empty form isn't sent and doesn't use up the token", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    turnstile.pass("token-1");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true"));
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(turnstile.api.reset).not.toHaveBeenCalled();
  });

  it("sign-up passes the token, and resets after", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<SignupForm />);
    await loadScript(turnstile.api);
    expect(turnstile.last().options.action).toBe("sign-up");
    turnstile.pass("token-signup");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Hunter22x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(auth.signUp).toHaveBeenCalledWith("mia@example.com", "Hunter22x", "token-signup");
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("password reset: the request passes the token; the confirm step has no widget", async () => {
    const turnstile = fakeTurnstile();
    const auth = renderWith(<ForgotPasswordForm />);
    await loadScript(turnstile.api);
    expect(turnstile.last().options.action).toBe("reset-password");
    turnstile.pass("token-reset");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mia@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByLabelText("Reset code");
    expect(auth.forgotPassword).toHaveBeenCalledWith("mia@example.com", "token-reset");
    expect(screen.queryByRole("group", { name: /human check/i })).toBeNull();
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("verify: Resend code passes the token; Verify email (not guarded) is unchanged", async () => {
    searchParams = new URLSearchParams({ email: "mia@example.com" });
    const turnstile = fakeTurnstile();
    const auth = renderWith(<VerifyForm />);
    await loadScript(turnstile.api);
    expect(turnstile.last().options.action).toBe("resend-code");
    turnstile.pass("token-resend");
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("New code sent.")).toBeInTheDocument();
    expect(auth.resendConfirmationCode).toHaveBeenCalledWith("mia@example.com", "token-resend");
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    await waitFor(() => expect(auth.confirmSignUp).toHaveBeenCalledWith("mia@example.com", "123456"));
  });

  it("inline sign-in (expired session) passes the token, and resets after", async () => {
    const turnstile = fakeTurnstile();
    const onSignedIn = vi.fn();
    const auth = renderWith(<InlineReauth onSignedIn={onSignedIn} />, { status: "signed-out" });
    await loadScript(turnstile.api);
    turnstile.pass("token-reauth");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(auth.signIn).toHaveBeenCalledWith("me@example.com", "hunter2", "token-reauth");
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1");
  });

  it("the widget is removed when its form goes", async () => {
    const turnstile = fakeTurnstile();
    renderWith(<LoginForm />);
    await loadScript(turnstile.api);
    cleanup();
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
  });
});
