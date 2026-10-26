"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import OAuthButtons from "@/components/auth/OAuthButtons";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice, PageHeader } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getMyInvite, viewInvite } from "@/lib/api/invites";
import type { AcceptInviteResult, InviteView, MyInvite } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatDayWithYear } from "@/lib/format";
import { useFragmentToken } from "@/lib/link-token";
import { withNext } from "@/lib/safe-next-path";
import InviteCreateAccount, { INVITE_PATH, type InviteAccountCreated } from "./InviteCreateAccount";
import InviteJoin, { INVITE_JOIN_ERROR_ID } from "./InviteJoin";
import { INVALID_LINK, inviteProblem, SUPPORT_LINK_LABEL, supportMailto, type InviteProblem } from "./invite-problems";

const SIGN_IN_HREF = withNext("/login", INVITE_PATH);
const SIGN_UP_HREF = withNext("/signup", INVITE_PATH);
const RESET_HREF = withNext("/forgot-password", INVITE_PATH);

const INTRO_ID = "invite-intro";

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: unknown };

/** GET /api/invites/me's answer: the invite, or none for this account (404). */
type Mine = { found: true; invite: MyInvite } | { found: false };

/**
 * The same invite, seen by its link (view) and by the signed-in account
 * (GET /me): neither carries an id the other has, but a link's kind,
 * expiry and organiser name are its own (a resend changes the expiry).
 */
function sameInvite(view: InviteView, invite: MyInvite): boolean {
  return (
    view.kind === invite.kind &&
    view.expiresAt === invite.expiresAt &&
    (view.organiserName ?? "") === (invite.organiserName ?? "")
  );
}

function inviteTitle(kind: "organiser" | "member", organiserName?: string): string {
  return kind === "organiser" ? `Set up ${organiserName ?? "your organiser"} on Sheltüh` : "Join Sheltüh";
}

function inviteIntro(view: InviteView): string {
  const what =
    view.kind === "organiser"
      ? `You’ve been invited to list events on Sheltüh as ${view.organiserName ?? "an organiser"}, approved from the start.`
      : "You’ve been invited to join Sheltüh.";
  return `${what} The invite is for ${view.maskedEmail} and works until ${formatDayWithYear(view.expiresAt)}.`;
}

/**
 * Where an emailed account invite lands (`/invite#token=…`;
 * docs/architecture.md, "Account invites"). Opening it only reads the
 * invite (a mail scanner changes nothing). Signed out, a new address
 * creates its account here with a password (or with Apple / Google, or the
 * ordinary sign-up when that's all there is), and an address with an
 * account signs in; either way it comes back here signed in (`?next=/invite`,
 * without the token: GET /me finds the invite by the verified address).
 * Signed in with the invite's address, Join accepts it: an organiser goes
 * on to the dashboard. Signed in as anyone else, it says so and offers to
 * sign out; it never swaps the session on its own.
 *
 * Not remounted per account (verifying the new account signs it in
 * mid-step): once Create account is pressed, its form keeps the screen
 * until it's done. Each new screen's heading takes focus, so it's read out.
 */
export default function InviteFlow() {
  const auth = useAuth();
  const router = useRouter();
  const fragment = useFragmentToken();
  const token = fragment.status === "ready" ? fragment.token : null;
  const configured = isApiConfigured && auth.configured;

  // The invite, by its link.
  const [viewAttempt, setViewAttempt] = useState(0);
  const viewKey = configured && token ? `${token}#${viewAttempt}` : null;
  const [viewResult, setViewResult] = useState<{ key: string; load: Load<InviteView> } | null>(null);

  // What happened here, which outranks what's loaded.
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [hasAccount, setHasAccount] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteAccountCreated | null>(null);
  const [accepted, setAccepted] = useState<AcceptInviteResult | null>(null);

  // The signed-in account's invite: not while Create account is under way (it
  // signs in mid-step), nor once it has found the invite itself.
  const [creating, setCreating] = useState(false);
  const [meAttempt, setMeAttempt] = useState(0);
  const signedIn = auth.status === "signed-in";
  const meNeeded = configured && signedIn && !creating && !created?.invite && !accepted;
  const meKey = meNeeded ? `${auth.userId ?? auth.email ?? ""}#${meAttempt}` : null;
  const [meResult, setMeResult] = useState<{ key: string; load: Load<Mine> } | null>(null);
  const getToken = auth.getAccessToken;

  useEffect(() => {
    if (!viewKey || !token) return;
    let cancelled = false;
    viewInvite(token).then(
      (value) => {
        if (!cancelled) setViewResult({ key: viewKey, load: { status: "ready", value } });
      },
      (error: unknown) => {
        if (!cancelled) setViewResult({ key: viewKey, load: { status: "error", error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [viewKey, token]);

  useEffect(() => {
    if (!meKey) return;
    let cancelled = false;
    getMyInvite(getToken).then(
      (invite) => {
        if (!cancelled) setMeResult({ key: meKey, load: { status: "ready", value: { found: true, invite } } });
      },
      (error: unknown) => {
        if (cancelled) return;
        const none = error instanceof ApiError && error.status === 404;
        setMeResult({ key: meKey, load: none ? { status: "ready", value: { found: false } } : { status: "error", error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [meKey, getToken]);

  // An organiser's accepted invite: on to their dashboard.
  const organiserAccepted = accepted?.kind === "organiser" || created?.accepted?.kind === "organiser";
  useEffect(() => {
    if (organiserAccepted) router.push("/dashboard");
  }, [organiserAccepted, router]);

  const view: Load<InviteView> | null = viewKey
    ? viewResult?.key === viewKey
      ? viewResult.load
      : { status: "loading" }
    : null;
  const mine: Load<Mine> | null = meKey ? (meResult?.key === meKey ? meResult.load : { status: "loading" }) : null;

  function signOutHere() {
    // Only this browser: the other account stays signed in elsewhere.
    auth.signOut("local");
  }

  function accountCreated(result: InviteAccountCreated) {
    setCreated(result);
    setCreating(false);
  }

  function begin() {
    setCreating(true);
  }

  function stop(update: () => void) {
    setCreating(false);
    update();
  }

  const screen = decide();
  const headingRef = useFocusOnScreenChange(screen.id, screen.focusFirst ?? false);

  function decide(): Screen {
    if (!configured) {
      return {
        id: "demo",
        title: "Invites work on the live site",
        body: (
          <>
            <DemoNotice>Account invites can’t be opened in this demo. Nothing was changed.</DemoNotice>
            <BackLinks links={[{ href: "/", label: "Back to Sheltüh" }]} />
          </>
        ),
      };
    }

    const finished = accepted ?? created?.accepted ?? null;
    if (finished) {
      return finished.kind === "organiser"
        ? {
            id: "joined-organiser",
            title: "You’re in",
            intro: "Your organiser profile is approved. Taking you to your dashboard…",
            body: <BackLinks links={[{ href: "/dashboard", label: "Go to your dashboard" }]} />,
          }
        : {
            id: "joined-member",
            title: "You’re in",
            intro: "Your Sheltüh account is ready.",
            body: (
              <BackLinks
                links={[
                  { href: "/events", label: "Browse events" },
                  { href: "/account", label: "Your account" },
                ]}
              />
            ),
          };
    }

    if (problem) return problemScreen(problem);

    if (created?.invite) return joinScreen(created.invite, created.acceptError);

    if (fragment.status === "loading" || auth.status === "loading") return LOADING;

    const viewed = view?.status === "ready" ? view.value : null;
    if (view?.status === "loading") return LOADING;
    // Signed in, a link that isn't valid (one a resend replaced, say) may still be this account's
    // invite: GET /me says whether one is waiting.
    const linkInvalid =
      signedIn && view?.status === "error" && view.error instanceof ApiError && view.error.status === 404;
    if (view?.status === "error" && !(linkInvalid && mine)) {
      return problemScreen(inviteProblem(view.error, "open this invite"), {
        attempt: viewAttempt,
        run: () => setViewAttempt((n) => n + 1),
      });
    }

    if (creating && viewed && token) return createScreen(viewed, token);

    if (signedIn && mine) {
      if (mine.status === "loading") return LOADING;
      if (mine.status === "error") {
        return problemScreen(inviteProblem(mine.error, "find your invite"), {
          attempt: meAttempt,
          run: () => setMeAttempt((n) => n + 1),
        });
      }
      const own = mine.value.found ? mine.value.invite : null;
      if (own && (!viewed || sameInvite(viewed, own))) return joinScreen(own, null);
      if (linkInvalid) return problemScreen(INVALID_LINK);
      if (viewed) {
        return {
          id: "other-account",
          title: `You’re signed in as ${auth.email ?? "another account"}`,
          intro: `This invite is for ${viewed.maskedEmail}. Sign out to continue.`,
          body: (
            <div className="flex flex-col items-start gap-3">
              <Button variant="solid" size="lg" onClick={signOutHere} className="w-full sm:w-auto">
                Sign out
              </Button>
              <BackLinks links={[{ href: "/events", label: "Keep using this account" }]} />
            </div>
          ),
        };
      }
      return {
        id: "no-invite",
        title: "No invite for this account",
        intro: `You’re signed in as ${auth.email ?? "an account"}, and there’s no invite waiting for that address. If your invite went to another address, sign out, then open the link in your email again.`,
        body: (
          <div className="flex flex-col items-start gap-3">
            <Button variant="outline" size="lg" onClick={signOutHere} className="w-full sm:w-auto">
              Sign out
            </Button>
            <BackLinks links={[{ href: "/events", label: "Browse events" }]} />
          </div>
        ),
      };
    }

    if (!viewed || !token) {
      return {
        id: "missing",
        title: "This invite link is incomplete",
        intro:
          "Open the link from your email again, making sure the whole link is used. If you’ve already set up your account, sign in to accept your invite.",
        focusFirst: true,
        body: (
          <div>
            <ButtonLink variant="solid" size="lg" href={SIGN_IN_HREF} className="w-full sm:w-auto">
              Sign in
            </ButtonLink>
          </div>
        ),
      };
    }

    // "unconfirmed": the address has only a never-confirmed account, which
    // someone else may have registered with a password they know. With
    // password setup on, the server replaces that account when the person
    // creates theirs; otherwise a password reset finishes it (it confirms the
    // address and replaces the password), never the ordinary sign-up.
    const account = viewed.account;
    if (account === "unconfirmed" && (!viewed.passwordSetup || unavailable)) {
      return {
        id: "unconfirmed-account",
        title: "Reset your password to accept your invite",
        intro: `An account for ${viewed.maskedEmail} was started but never confirmed. Reset its password: we’ll email that address a code, you choose a new password, then sign in and come back here to accept.`,
        body: (
          <div className="flex flex-col gap-4">
            {/* Not the server's 503 words: they point at the sign-up, which this account can't use. */}
            {unavailable && <Notice>We couldn’t set up your account from here, so reset its password instead.</Notice>}
            <div>
              <ButtonLink variant="solid" size="lg" href={RESET_HREF} className="w-full sm:w-auto">
                Reset password
              </ButtonLink>
            </div>
          </div>
        ),
      };
    }

    if (account === "existing" || hasAccount) {
      return {
        id: "existing-account",
        title: "Sign in to accept your invite",
        intro: `${viewed.maskedEmail} already has a Sheltüh account. Sign in with it, and you’ll come back here to accept.`,
        body: (
          <div className="flex flex-col items-start gap-3">
            <ButtonLink variant="solid" size="lg" href={SIGN_IN_HREF} className="w-full sm:w-auto">
              Sign in
            </ButtonLink>
            <BackLinks links={[{ href: RESET_HREF, label: "Forgot your password?" }]} />
          </div>
        ),
      };
    }

    if (viewed.passwordSetup && !unavailable) return createScreen(viewed, token);

    return {
      id: "sign-up",
      title: inviteTitle(viewed.kind, viewed.organiserName),
      intro: inviteIntro(viewed),
      body: (
        <div className="flex flex-col gap-8">
          {unavailable && <Notice>{unavailable}</Notice>}
          <OAuthButtons next={INVITE_PATH} />
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">
              Create your account with {viewed.maskedEmail}, the address this invite was sent to. Once it’s
              confirmed, you’ll come back here to accept.
            </p>
            <div>
              <ButtonLink variant="solid" size="lg" href={SIGN_UP_HREF} className="w-full sm:w-auto">
                Create account
              </ButtonLink>
            </div>
            <p className="text-sm text-muted">
              Already have an account?{" "}
              <Link href={SIGN_IN_HREF} className="text-accent underline underline-offset-2">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      ),
    };
  }

  function createScreen(viewed: InviteView, linkToken: string): Screen {
    return {
      id: "create",
      title: inviteTitle(viewed.kind, viewed.organiserName),
      intro: inviteIntro(viewed),
      body: (
        <div className="flex flex-col gap-8">
          {/* Hidden once Create account is pressed: the new account is signing in. */}
          {!creating && <OAuthButtons next={INVITE_PATH} />}
          <InviteCreateAccount
            token={linkToken}
            maskedEmail={viewed.maskedEmail}
            onBegin={begin}
            onIdle={() => setCreating(false)}
            onCreated={accountCreated}
            onHasAccount={() => stop(() => setHasAccount(true))}
            onUnavailable={(message) =>
              stop(() => {
                setUnavailable(message);
                // Read the invite again: the address may have an unconfirmed account (reset, not sign up).
                setViewAttempt((n) => n + 1);
              })
            }
            onProblem={(next) => stop(() => setProblem({ ...next, kind: viewed.kind }))}
          />
        </div>
      ),
    };
  }

  function joinScreen(invite: MyInvite, acceptError: string | null): Screen {
    const organiser = invite.kind === "organiser";
    return {
      id: `join-${invite.inviteId}`,
      title: organiser ? `Join Sheltüh as ${invite.organiserName ?? "an organiser"}` : "Accept your invite",
      intro: organiser
        ? `Joining sets up ${invite.organiserName ?? "your organiser"} as an approved organiser, run by this account (${auth.email ?? "you"}). You can list events from your dashboard straight away.`
        : `Accepting finishes setting up your Sheltüh account (${auth.email ?? "you"}).`,
      // Accepting already failed (straight after Create account): read out with the heading.
      describedBy: acceptError ? INVITE_JOIN_ERROR_ID : undefined,
      body: <InviteJoin invite={invite} initialError={acceptError} onAccepted={setAccepted} onProblem={setProblem} />,
    };
  }

  /** `retry.attempt`: which try this is, so the same failure again is a new screen (its heading takes focus). */
  function problemScreen(shown: InviteProblem, retry?: { attempt: number; run: () => void }): Screen {
    // A used invite made a member's account (or one whose kind isn't known here): their account, not the dashboard.
    const home =
      shown.reason === "used" && shown.kind !== "organiser"
        ? { href: "/account", label: "Your account" }
        : { href: "/dashboard", label: "Go to your dashboard" };
    const links =
      shown.reason === "used" || shown.reason === "not-yours"
        ? signedIn
          ? [home, { href: "/events", label: "Browse events" }]
          : [{ href: SIGN_IN_HREF, label: "Sign in" }]
        : [{ href: "/", label: "Back to Sheltüh" }];
    if (shown.contactSubject) links.unshift({ href: supportMailto(shown.contactSubject), label: SUPPORT_LINK_LABEL });
    return {
      id: `problem-${shown.reason}-${shown.title}-${retry?.attempt ?? 0}`,
      title: shown.title,
      intro: shown.message,
      focusFirst: true,
      body: (
        <div className="flex flex-col items-start gap-3">
          {shown.retry && retry && (
            <Button variant="outline" size="lg" onClick={retry.run}>
              Try again
            </Button>
          )}
          {shown.reason === "not-yours" && signedIn && (
            <Button variant="outline" size="lg" onClick={signOutHere}>
              Sign out
            </Button>
          )}
          <BackLinks links={links} />
        </div>
      ),
    };
  }

  if (screen.id === "loading") {
    return <LoadingState text="Loading…" />;
  }

  return (
    <>
      <PageHeader
        flush
        eyebrow="Invite"
        title={screen.title}
        intro={screen.intro && <p id={INTRO_ID}>{screen.intro}</p>}
        titleRef={headingRef}
        titleDescribedBy={[screen.intro ? INTRO_ID : null, screen.describedBy].filter(Boolean).join(" ") || undefined}
      />
      {screen.body}
    </>
  );
}

interface Screen {
  /** Changes whenever what's on screen does: the heading then takes focus. */
  id: string;
  title: string;
  intro?: string;
  /** More of what the heading is described by, after the intro (an element's id). */
  describedBy?: string;
  body?: ReactNode;
  /** Take focus even as the page's first screen (an outcome that ends the visit, as EmailLinkAction does). */
  focusFirst?: boolean;
}

const LOADING: Screen = { id: "loading", title: "Loading" };

function BackLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {links.map((link) => (
        <li key={link.href}>
          {link.href.startsWith("mailto:") ? (
            <a href={link.href} className="inline-flex min-h-11 items-center break-all underline underline-offset-4">
              {link.label}
            </a>
          ) : (
            <Link href={link.href} className="inline-flex min-h-11 items-center underline underline-offset-4">
              {link.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Moves focus to the heading when the screen changes, so the new step is
 * read out. The first screen a visit lands on keeps the browser's own
 * focus unless it's an outcome (`focusFirst`); loading doesn't count.
 */
function useFocusOnScreenChange(id: string, focusFirst: boolean) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (id === "loading" || shown.current === id) return;
    const first = shown.current === null;
    shown.current = id;
    if (!first || focusFirst) headingRef.current?.focus();
  }, [id, focusFirst]);
  return headingRef;
}
