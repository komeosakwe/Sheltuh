"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getServerTheme, getTheme, subscribeTheme } from "@/lib/theme";
import { loadTurnstile, turnstileSiteKey, type HumanCheckAction, type TurnstileApi } from "./turnstile";

/**
 * How long a submit waits for a token that isn't there yet (the script still
 * loading, or Cloudflare still checking), unless the widget is asking the
 * person to do something: then it waits for them (Turnstile's own timeout
 * ends that).
 */
export const HUMAN_CHECK_WAIT_MS = 15_000;

/** The widget's problem, said under it: it failed or timed out, the script didn't load, or the browser can't run it. */
export type HumanCheckProblem = "failed" | "load-failed" | "unsupported";

type WakeReason = "token" | "problem" | "interactive";

export interface HumanCheck {
  /** NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Off: getToken resolves undefined at once and nothing is loaded. */
  enabled: boolean;
  /**
   * A token for the next Supabase call, handed out once (it's single use: a
   * second call waits for Turnstile's next one, after `reset`), waiting for one if Cloudflare is
   * still checking (HUMAN_CHECK_WAIT_MS, longer while the widget asks for a
   * tap). Resolves undefined, never rejects, when it's off or no token can be
   * had: the request is then sent without one and Supabase decides (it
   * refuses it only when its CAPTCHA protection is on).
   */
  getToken: () => Promise<string | undefined>;
  /** Tokens are single use: call after every attempt that may have used one (success or failure). */
  reset: () => void;
  /** For <HumanCheckField>. */
  view: {
    containerRef: (element: HTMLDivElement | null) => void;
    /** A submit is waiting for a token. */
    waiting: boolean;
    /** The widget is showing a challenge to complete. */
    interactive: boolean;
    problem: HumanCheckProblem | null;
  };
}

/**
 * Cloudflare Turnstile for one form (lib/auth/turnstile.ts). The widget is
 * rendered once its container (<HumanCheckField>) is on the page, so a form
 * that isn't shown (demo mode) loads nothing. Managed mode, "interaction-only":
 * invisible unless Cloudflare needs the person to tick a box. In the site's
 * Light or Dark theme (a theme change renders it again), "flexible" width, or
 * "compact" where the form is narrower than its 300px minimum.
 */
export function useHumanCheck(action: HumanCheckAction): HumanCheck {
  const siteKey = turnstileSiteKey();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Bumped to load the script again after it failed to.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [problem, setProblem] = useState<HumanCheckProblem | null>(null);

  const token = useRef<string | null>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const problemNow = useRef<HumanCheckProblem | null>(null);
  const interactiveNow = useRef(false);
  const waiters = useRef(new Set<(reason: WakeReason) => void>());

  const wake = useCallback((reason: WakeReason) => {
    for (const waiter of [...waiters.current]) waiter(reason);
  }, []);

  const report = useCallback(
    (next: HumanCheckProblem | null) => {
      problemNow.current = next;
      setProblem(next);
      if (next) wake("problem");
    },
    [wake],
  );

  const setInteractiveNow = useCallback(
    (value: boolean) => {
      interactiveNow.current = value;
      setInteractive(value);
      wake("interactive");
    },
    [wake],
  );

  useEffect(() => {
    if (!siteKey || !container) return;
    let live = true;
    let rendered: { api: TurnstileApi; id: string } | null = null;
    loadTurnstile().then(
      (api) => {
        if (!live) return;
        try {
          const id = api.render(container, {
            sitekey: siteKey,
            action,
            theme,
            size: container.clientWidth >= 300 ? "flexible" : "compact",
            appearance: "interaction-only",
            retry: "auto",
            "refresh-expired": "auto",
            "response-field": false,
            callback: (value) => {
              token.current = value;
              report(null);
              wake("token");
            },
            "expired-callback": () => {
              // Turnstile gets a new one by itself ("refresh-expired": "auto").
              token.current = null;
            },
            "error-callback": () => {
              token.current = null;
              report("failed");
              return true;
            },
            "timeout-callback": () => {
              token.current = null;
              report("failed");
            },
            "unsupported-callback": () => {
              token.current = null;
              report("unsupported");
            },
            "before-interactive-callback": () => setInteractiveNow(true),
            "after-interactive-callback": () => setInteractiveNow(false),
          });
          if (!id) throw new Error("Turnstile didn't render.");
          rendered = { api, id };
          widget.current = rendered;
        } catch {
          report("failed");
        }
      },
      () => {
        if (live) report("load-failed");
      },
    );
    return () => {
      live = false;
      token.current = null;
      widget.current = null;
      if (interactiveNow.current) setInteractiveNow(false);
      if (rendered) rendered.api.remove(rendered.id);
    };
  }, [siteKey, container, theme, action, loadAttempt, report, wake, setInteractiveNow]);

  // A wait still running when the form goes (its step changed): it gets no token.
  useEffect(() => () => wake("problem"), [wake]);

  const reset = useCallback(() => {
    token.current = null;
    const was = problemNow.current;
    if (was) report(null);
    if (widget.current) widget.current.api.reset(widget.current.id);
    else if (was === "load-failed") setLoadAttempt((n) => n + 1);
  }, [report]);

  /** The current token, which is then no longer held: single use. */
  const takeToken = useCallback((): string | undefined => {
    const value = token.current ?? undefined;
    token.current = null;
    return value;
  }, []);

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!siteKey) return Promise.resolve(undefined);
    if (token.current) return Promise.resolve(takeToken());
    if (problemNow.current === "unsupported") return Promise.resolve(undefined);
    // A failed check (or script) gets another go for this submit.
    if (problemNow.current) reset();
    setWaiting(true);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: string | undefined) => {
        clearTimeout(timer);
        waiters.current.delete(waiter);
        if (waiters.current.size === 0) setWaiting(false);
        resolve(value);
      };
      // No deadline while the person is completing a challenge.
      const arm = () => {
        clearTimeout(timer);
        timer = interactiveNow.current ? undefined : setTimeout(() => finish(undefined), HUMAN_CHECK_WAIT_MS);
      };
      const waiter = (reason: WakeReason) => {
        if (reason === "token") {
          // Another wait may have taken it: then keep waiting for the next.
          const value = takeToken();
          if (value) finish(value);
        } else if (reason === "problem") finish(undefined);
        else arm();
      };
      waiters.current.add(waiter);
      arm();
    });
  }, [siteKey, reset, takeToken]);

  return {
    enabled: Boolean(siteKey),
    getToken,
    reset,
    view: { containerRef: setContainer, waiting, interactive, problem },
  };
}
