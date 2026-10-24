"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  OAUTH_DEFAULT_NEXT,
  OAUTH_ERROR_COPY,
  oauthExchangeErrorKind,
  parseOAuthCallback,
  SUPPORT_EMAIL,
  type OAuthErrorKind,
} from "@/lib/auth/oauth";
import { withNext } from "@/lib/safe-next-path";

type State =
  | { status: "working" }
  | { status: "unconfigured" }
  | { status: "error"; kind: OAuthErrorKind; next: string | null };

const BODY_CLASS = "max-w-md text-base leading-6 text-muted";
const ACTIONS_CLASS = "flex flex-col gap-3 sm:flex-row";

/**
 * /auth/callback (docs/design/social-sign-in.md §5): where Supabase Auth
 * sends the browser back after Google or Apple, with `?code=…` (or an error)
 * and our own `?next=`.
 *
 * The URL is read once, in an effect (so the server render and hydration
 * agree), and at once removed from the address bar so the code doesn't
 * linger in history. The read and the exchange are guarded by a ref:
 * StrictMode runs effects twice in development, and a code works only once.
 * Then it's on to `next` (checked again here: anyone can craft this URL), or
 * the dashboard.
 *
 * Errors show only our own copy (lib/auth/oauth.ts), never the URL's
 * `error_description`. There's no "Try again": a failed exchange has used
 * up the code and its verifier, so the way on is to start again.
 */
export default function OAuthCallback() {
  const { configured, completeOAuthSignIn } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "working" });
  const started = useRef(false);
  const mounted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const { pathname, search, hash } = window.location;
    const callback = parseOAuthCallback(search, hash);
    if (search || hash) window.history.replaceState(null, "", pathname);

    if (!configured) {
      // Deferred so the effect body itself never calls setState.
      queueMicrotask(() => setState({ status: "unconfigured" }));
      return;
    }
    if (callback.kind === "error") {
      const { error, next } = callback;
      queueMicrotask(() => setState({ status: "error", kind: error, next }));
      return;
    }

    const { code, next } = callback;
    completeOAuthSignIn(code).then(
      () => {
        if (mounted.current) router.replace(next ?? OAUTH_DEFAULT_NEXT);
      },
      (err: unknown) => {
        setState({ status: "error", kind: oauthExchangeErrorKind(err), next });
      },
    );
  }, [configured, completeOAuthSignIn, router]);

  useEffect(() => {
    if (state.status === "error" || state.status === "unconfigured") headingRef.current?.focus();
  }, [state.status]);

  if (state.status === "working") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader flush eyebrow="Account" title="Signing in" />
        <DotsLoader announce label="Signing you in" />
      </div>
    );
  }

  if (state.status === "unconfigured") {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader flush eyebrow="Account" title="Accounts aren’t configured" titleRef={headingRef} />
        <p className={BODY_CLASS}>
          Accounts aren&rsquo;t configured in this environment yet, so Apple and Google sign-in aren&rsquo;t available.
        </p>
        <div className={ACTIONS_CLASS}>
          <ButtonLink variant="outline" size="lg" href="/events" className="w-full sm:w-auto">
            Browse events
          </ButtonLink>
        </div>
      </div>
    );
  }

  const { kind, next } = state;
  const copy = OAUTH_ERROR_COPY[kind];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader flush eyebrow="Account" title={copy.title} titleRef={headingRef} />
      {kind === "banned" ? (
        <p className={BODY_CLASS}>
          If you think this is a mistake, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      ) : (
        <p className={BODY_CLASS}>{copy.message}</p>
      )}
      <div className={ACTIONS_CLASS}>
        <ButtonLink variant="solid" size="lg" href={withNext("/login", next)} className="w-full sm:w-auto">
          Back to sign in
        </ButtonLink>
        {kind !== "banned" && (
          <ButtonLink variant="outline" size="lg" href={`${withNext("/login", next)}#email`} className="w-full sm:w-auto">
            Use email instead
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
