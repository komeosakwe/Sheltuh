"use client";

import { HUMAN_CHECK_FAILED, TURNSTILE_PRIVACY_URL } from "@/lib/auth/turnstile";
import type { HumanCheck, HumanCheckProblem } from "@/lib/auth/useHumanCheck";

const PROBLEM_TEXT: Record<HumanCheckProblem, string> = {
  failed: HUMAN_CHECK_FAILED,
  "load-failed": "Couldn’t load the human check. Check your connection or content blocker, then try again.",
  unsupported: "This browser can’t run the human check. Try updating it, or use another browser.",
};

/**
 * Cloudflare Turnstile's widget for a form (lib/auth/useHumanCheck.ts), under
 * its submit button: nothing at all when it's off. Usually invisible (it shows
 * itself only when Cloudflare wants a tap), with a polite status line for
 * "Checking you're human…" and any problem, and a short line saying who
 * runs the check, linking Cloudflare's privacy notice (Privacy Act APP 5).
 * The widget's own iframe is Cloudflare's; its container is a labelled group.
 */
export default function HumanCheckField({ check, compact = false }: { check: HumanCheck; compact?: boolean }) {
  if (!check.enabled) return null;
  const { containerRef, waiting, interactive, problem } = check.view;
  const status = waiting
    ? interactive
      ? "Complete the Cloudflare check to continue."
      : "Checking you’re human…"
    : problem
      ? PROBLEM_TEXT[problem]
      : null;
  const text = compact ? "text-xs" : "text-sm leading-5";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div ref={containerRef} role="group" aria-label="Human check (Cloudflare Turnstile)" className="max-w-full" />
      {/* Always mounted, so a new message is announced. */}
      <p role="status" className={`${text} ${!waiting && problem ? "text-danger" : "text-muted"} empty:hidden`}>
        {status}
      </p>
      <p className={`${text} text-muted`}>
        Protected by Cloudflare Turnstile (
        <a
          href={TURNSTILE_PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-4"
        >
          Cloudflare privacy<span className="sr-only"> (opens in a new tab)</span>
        </a>
        ).
      </p>
    </div>
  );
}
