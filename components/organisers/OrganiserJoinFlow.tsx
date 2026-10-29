"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import DemoNotice from "@/components/DemoNotice";
import { supportMailto, SUPPORT_LINK_LABEL } from "@/components/invites/invite-problems";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { PageHeader } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { joinWithOrganiserLink, viewOrganiserLink } from "@/lib/api/organiser-links";
import type { OrganiserLinkJoinResult, OrganiserLinkView } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { formatDayWithYear } from "@/lib/format";
import { ORGANISER_JOIN_PATH, ORGANISER_LINK_UNAVAILABLE } from "@/lib/invites";
import { LINK_TOKEN_PATTERN, useFragmentToken, type FragmentToken } from "@/lib/link-token";
import { withNext } from "@/lib/safe-next-path";
import { EVENT_CATEGORIES, type EventCategory } from "@/lib/types";

/** Where joining lands: the dashboard says welcome (DashboardContent). */
export const JOINED_PATH = "/dashboard?welcome=organiser";

const SIGN_UP_HREF = withNext("/signup", ORGANISER_JOIN_PATH);
const SIGN_IN_HREF = withNext("/login", ORGANISER_JOIN_PATH);
const NEW_LINK_SUBJECT = "New organiser link";
const MAX_NAME_LENGTH = 120;

const INTRO_ID = "organiser-join-intro";
const NAME_ID = "organiser-join-name";
const FORM_ERROR_ID = "organiser-join-error";
const categoryId = (value: string) => `organiser-join-category-${value}`;

/**
 * The link's token for this tab: kept in sessionStorage while the person
 * signs up or signs in (they come back to `/organisers/join` without it,
 * `?next=` carries no token), and forgotten once it's used or can't be.
 * Never a cookie, a query string or localStorage: it stays in this tab and
 * never reaches a server except in the API's request body.
 */
const STORAGE_KEY = "sheltuh:organiser-link";

function forgetToken() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** The fragment's token (kept for the round trip through sign-up), or the one this tab kept. */
function useOrganiserLinkToken(): FragmentToken {
  const fragment = useFragmentToken();
  const [state, setState] = useState<FragmentToken>({ status: "loading" });
  useEffect(() => {
    if (fragment.status === "loading") return;
    queueMicrotask(() => {
      if (fragment.status === "ready") {
        try {
          sessionStorage.setItem(STORAGE_KEY, fragment.token);
        } catch {
          // Storage blocked: the link still works in this visit.
        }
        setState(fragment);
        return;
      }
      let kept: string | null = null;
      try {
        kept = sessionStorage.getItem(STORAGE_KEY);
      } catch {
        kept = null;
      }
      setState(kept && LINK_TOKEN_PATTERN.test(kept) ? { status: "ready", token: kept } : { status: "missing" });
    });
  }, [fragment]);
  return state;
}

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: unknown };

interface Screen {
  /** Changes whenever what's on screen does: the heading then takes focus. */
  id: string;
  title: string;
  intro?: string;
  body?: ReactNode;
  /** Take focus even as the page's first screen (an outcome that ends the visit). */
  focusFirst?: boolean;
}

const LOADING: Screen = { id: "loading", title: "Loading" };
const INVITED_TITLE = "You’ve been invited to sell tickets on Sheltüh";

function isUnavailable(err: unknown) {
  return err instanceof ApiError && err.status === 404;
}

function apiCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Where an organiser link lands (`/organisers/join#token=…`;
 * docs/architecture.md, "Organiser links"). Opening it only checks the link
 * (a chat app's preview changes nothing). Signed out: sign up or sign in,
 * then back here (`?next=/organisers/join`; the token waits in this tab's
 * sessionStorage). Signed in: the organiser name and categories, then Join,
 * and on to the dashboard. An account that already has an organiser is
 * told what happens (a pending application is approved; an approved,
 * rejected or taken-down one can't use the link, which stays unused). Each
 * new screen's heading takes focus, so it's read out.
 */
export default function OrganiserJoinFlow() {
  const auth = useAuth();
  const router = useRouter();
  const link = useOrganiserLinkToken();
  const token = link.status === "ready" ? link.token : null;
  const configured = isApiConfigured && auth.configured;
  const signedIn = auth.status === "signed-in";
  const { loading: organiserLoading, organiser, error: organiserError, refetch } = useOrganiser();

  const [viewAttempt, setViewAttempt] = useState(0);
  const viewKey = configured && token ? `${token}#${viewAttempt}` : null;
  const [viewResult, setViewResult] = useState<{ key: string; load: Load<OrganiserLinkView> } | null>(null);
  /** The link turned out unusable while joining. */
  const [gone, setGone] = useState(false);
  /**
   * The account (user id) whose join was refused (409 `rejected`): its
   * organiser was taken down or rejected, or is pending again after a
   * takedown, which the account's own record doesn't show. Another account
   * signed in here starts afresh.
   */
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const refused = signedIn && refusedFor !== null && refusedFor === (auth.userId ?? "");
  const [joined, setJoined] = useState<OrganiserLinkJoinResult | null>(null);

  useEffect(() => {
    if (!viewKey || !token) return;
    let cancelled = false;
    viewOrganiserLink(token).then(
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

  const view: Load<OrganiserLinkView> | null = viewKey
    ? viewResult?.key === viewKey
      ? viewResult.load
      : { status: "loading" }
    : null;
  const unavailable = gone || (view?.status === "error" && isUnavailable(view.error));

  // A link that can't be used is forgotten, and so is one that's been used.
  useEffect(() => {
    if (unavailable || joined) forgetToken();
  }, [unavailable, joined]);

  useEffect(() => {
    if (joined) router.push(JOINED_PATH);
  }, [joined, router]);

  const screen = decide();
  const headingRef = useFocusOnScreenChange(screen.id, screen.focusFirst ?? false);

  function signOutHere() {
    auth.signOut("local");
  }

  function decide(): Screen {
    if (!configured) {
      return {
        id: "demo",
        title: "Organiser links work on the live site",
        body: (
          <>
            <DemoNotice>Organiser links can’t be opened in this demo. Nothing was changed.</DemoNotice>
            <BackLinks links={[{ href: "/", label: "Back to Sheltüh" }]} />
          </>
        ),
      };
    }

    if (joined) {
      return {
        id: "joined",
        title: "You’re in",
        intro: `${joined.displayName} is an approved organiser. Taking you to your dashboard…`,
        body: <BackLinks links={[{ href: JOINED_PATH, label: "Go to your dashboard" }]} />,
      };
    }

    if (unavailable) {
      return {
        id: "unavailable",
        title: "This link can’t be used",
        intro: ORGANISER_LINK_UNAVAILABLE,
        focusFirst: true,
        body: (
          <BackLinks
            links={[
              { href: supportMailto(NEW_LINK_SUBJECT), label: SUPPORT_LINK_LABEL },
              { href: "/", label: "Back to Sheltüh" },
            ]}
          />
        ),
      };
    }

    if (link.status === "loading" || auth.status === "loading") return LOADING;

    if (link.status === "missing") {
      return {
        id: "missing",
        title: "This link is incomplete",
        intro:
          "Open the link again from the message you were sent, making sure the whole link is used. If it still doesn’t work, ask Sheltüh for a new one.",
        focusFirst: true,
        body: <BackLinks links={[{ href: supportMailto(NEW_LINK_SUBJECT), label: SUPPORT_LINK_LABEL }]} />,
      };
    }

    if (!view || view.status === "loading") return LOADING;
    if (view.status === "error") {
      const tooMany = view.error instanceof ApiError && view.error.status === 429;
      return {
        id: `view-error-${viewAttempt}`,
        title: "We couldn’t check this link",
        intro: tooMany
          ? "That’s been tried a lot. Wait a while, then try again."
          : "Check your connection, then try again.",
        focusFirst: true,
        body: (
          <div className="flex flex-col items-start gap-3">
            <Button variant="outline" size="lg" onClick={() => setViewAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ),
      };
    }

    const until = formatDayWithYear(view.value.expiresAt);

    if (!signedIn) {
      return {
        id: "signed-out",
        title: INVITED_TITLE,
        intro: `You’re approved straight away. This link works once, until ${until}.`,
        body: (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">
              Sign in or create an account to continue.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ButtonLink variant="solid" size="lg" href={SIGN_UP_HREF} className="w-full sm:w-auto">
                Create account
              </ButtonLink>
              <ButtonLink variant="outline" size="lg" href={SIGN_IN_HREF} className="w-full sm:w-auto">
                Sign in
              </ButtonLink>
            </div>
          </div>
        ),
      };
    }

    if (organiserLoading) return LOADING;
    if (organiserError) {
      return {
        id: "organiser-error",
        title: "We couldn’t load your account",
        intro: organiserError,
        focusFirst: true,
        body: (
          <div>
            <Button variant="outline" size="lg" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ),
      };
    }

    const account = auth.email ?? "this account";
    if (organiser?.status === "approved") {
      return {
        id: "already-organiser",
        title: "You’re already an organiser",
        intro: `${account} already runs ${organiser.displayName}, so this link wasn’t used. Pass it back to whoever sent it, or sign out and use another account.`,
        focusFirst: true,
        body: (
          <div className="flex flex-col items-start gap-3">
            <ButtonLink variant="solid" size="lg" href="/dashboard" className="w-full sm:w-auto">
              Go to your dashboard
            </ButtonLink>
            <Button variant="outline" size="lg" onClick={signOutHere} className="w-full sm:w-auto">
              Sign out
            </Button>
          </div>
        ),
      };
    }
    if (organiser?.status === "rejected" || refused) {
      return {
        id: "rejected",
        title: "This account can’t join with this link",
        intro:
          organiser?.status === "rejected"
            ? `The organiser profile on ${account} isn’t active, so this link wasn’t used. Contact the Sheltüh team, or sign out and use another account.`
            : `The organiser profile on ${account} can’t be approved with a link, so this link wasn’t used. Contact the Sheltüh team, or sign out and use another account.`,
        focusFirst: true,
        body: (
          <div className="flex flex-col items-start gap-3">
            <Button variant="outline" size="lg" onClick={signOutHere} className="w-full sm:w-auto">
              Sign out
            </Button>
            <BackLinks links={[{ href: supportMailto("Organiser link"), label: SUPPORT_LINK_LABEL }]} />
          </div>
        ),
      };
    }

    return {
      id: organiser?.status === "pending" ? "join-pending" : "join",
      title: INVITED_TITLE,
      intro:
        organiser?.status === "pending"
          ? `Your application for ${organiser.displayName} is waiting for review. Joining with this link approves it now. The link works once, until ${until}.`
          : `Name your organiser to be approved straight away. The link works once, until ${until}.`,
      body: (
        <JoinForm
          token={token as string}
          pendingName={organiser?.status === "pending" ? organiser.displayName : null}
          account={account}
          onJoined={setJoined}
          onGone={() => setGone(true)}
          onRefused={() => setRefusedFor(auth.userId ?? "")}
          onStatusChanged={() => void refetch()}
          onSignOut={signOutHere}
        />
      ),
    };
  }

  if (screen.id === "loading") return <LoadingState text="Loading…" />;

  return (
    <>
      <PageHeader
        flush
        eyebrow="For organisers"
        title={screen.title}
        intro={screen.intro && <p id={INTRO_ID}>{screen.intro}</p>}
        titleRef={headingRef}
        titleDescribedBy={screen.intro ? INTRO_ID : undefined}
      />
      {screen.body}
    </>
  );
}

/**
 * The organiser name and categories (the application's rules: a name up to
 * 120 characters, at least one category), or for a pending application just
 * Join. Errors are shown on their fields, and focus goes to the first one.
 */
function JoinForm({
  token,
  pendingName,
  account,
  onJoined,
  onGone,
  onRefused,
  onStatusChanged,
  onSignOut,
}: {
  token: string;
  /** The pending application's name: it's approved as it is, so nothing is asked. */
  pendingName: string | null;
  account: string;
  onJoined: (result: OrganiserLinkJoinResult) => void;
  onGone: () => void;
  /** This account's organiser can't be approved with a link (409 `rejected`). */
  onRefused: () => void;
  /** The account's organiser changed (409): read it again. */
  onStatusChanged: () => void;
  onSignOut: () => void;
}) {
  const auth = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focusError = useRef(false);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!focusError.current) return;
    focusError.current = false;
    if (errors.displayName) document.getElementById(NAME_ID)?.focus();
    else if (errors.categories) document.getElementById(categoryId(EVENT_CATEGORIES[0].value))?.focus();
    else formErrorRef.current?.focus();
  }, [errors, formError]);

  function validate(): Record<string, string> {
    if (pendingName) return {};
    const next: Record<string, string> = {};
    if (!displayName.trim()) next.displayName = "Enter your organiser name.";
    else if (displayName.length > MAX_NAME_LENGTH) next.displayName = `Use ${MAX_NAME_LENGTH} characters or fewer.`;
    if (categories.length === 0) next.categories = "Choose at least one category.";
    return next;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) {
      focusError.current = true;
      return;
    }
    setBusy(true);
    try {
      const result = await joinWithOrganiserLink(
        pendingName ? { token } : { token, displayName: displayName.trim(), categories },
        auth.getAccessToken,
      );
      onJoined(result);
    } catch (err) {
      if (isUnavailable(err)) {
        onGone();
        return;
      }
      const code = apiCode(err);
      if (code === "rejected") {
        onRefused();
        return;
      }
      if (code === "already_organiser") {
        onStatusChanged();
        return;
      }
      if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setErrors(err.fieldErrors);
      } else if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) {
        setFormError("Your session has ended. Sign in again, then come back to this link.");
      } else if (err instanceof ApiError && err.status === 403) {
        setFormError("Confirm your email address first, then try again.");
      } else {
        setFormError(err instanceof ApiError && err.message ? err.message : "Couldn’t join. Try again.");
      }
      focusError.current = true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Join as an organiser" className="flex flex-col gap-6">
      {formError && (
        <p
          ref={formErrorRef}
          id={FORM_ERROR_ID}
          role="alert"
          tabIndex={-1}
          className="border-l-2 border-danger py-1 pl-4 text-sm text-foreground outline-offset-2"
        >
          {formError}
        </p>
      )}

      {!pendingName && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={NAME_ID} className="eyebrow text-muted">
              Organiser name
            </label>
            <input
              id={NAME_ID}
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="organization"
              aria-required
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={[`${NAME_ID}-note`, errors.displayName ? `${NAME_ID}-error` : null].filter(Boolean).join(" ")}
              className="min-h-11 w-full min-w-0 border border-foreground bg-transparent px-3 py-2 text-foreground"
            />
            <p id={`${NAME_ID}-note`} className="text-sm text-muted">
              Buyers see this on your events. Changing it later needs us.
            </p>
            {errors.displayName && (
              <p id={`${NAME_ID}-error`} className="text-sm text-danger">
                {errors.displayName}
              </p>
            )}
          </div>

          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors.categories ? "organiser-join-categories-error" : undefined}
          >
            <legend className="eyebrow text-muted">What you put on</legend>
            <div className="flex flex-wrap gap-x-4">
              {EVENT_CATEGORIES.map((c) => (
                <label key={c.value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input
                    id={categoryId(c.value)}
                    type="checkbox"
                    checked={categories.includes(c.value)}
                    onChange={(e) =>
                      setCategories((prev) => (e.target.checked ? [...prev, c.value] : prev.filter((v) => v !== c.value)))
                    }
                    aria-invalid={errors.categories ? true : undefined}
                    className="size-5 accent-accent"
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {errors.categories && (
              <p id="organiser-join-categories-error" className="text-sm text-danger">
                {errors.categories}
              </p>
            )}
          </fieldset>
        </>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <Button
            type="submit"
            variant="solid"
            size="lg"
            busy={busy}
            aria-describedby={formError ? FORM_ERROR_ID : undefined}
            className="w-full sm:w-auto"
          >
            {busy ? "Joining…" : "Join as an organiser"}
          </Button>
        </div>
        <p className="text-sm text-muted">
          Signed in as <span className="break-all text-foreground">{account}</span>.{" "}
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex min-h-11 items-center text-accent underline underline-offset-2"
          >
            Not you? Sign out
          </button>
        </p>
      </div>
    </form>
  );
}

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
 * read out. The first screen a visit lands on keeps the browser's own focus
 * unless it's an outcome (`focusFirst`); loading doesn't count.
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
