"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError } from "@/lib/api/client";
import { followOrganiser, getFollowStatus, unfollowOrganiser } from "@/lib/api/follows";
import type { FollowStatus } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { withNext } from "@/lib/safe-next-path";

type Load = { status: "loading" } | { status: "ready"; follow: FollowStatus } | { status: "hidden" };

function errorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) return SESSION_EXPIRED_MESSAGE;
  // 403 "verify your email", 400 your own organiser, 409 500 follows, 429: the API's words.
  if (err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500))) return err.message;
  return "Couldn’t update that. Try again.";
}

/**
 * Follow an organiser (docs/architecture.md, "Following organisers"): a
 * toggle button ("Follow" / "Following", aria-pressed) and, beside it, the
 * choice of an email when they announce a new event (unticked until they
 * tick it: consent under the Spam Act, so the request always says which;
 * changeable while following; every such email can be unsubscribed
 * from at /following/unsubscribe). Signed out: a link to sign in that comes
 * back here. Nobody sees who follows whom.
 */
export default function FollowButton({ organiserId, organiserName }: { organiserId: string; organiserName: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const getToken = signedIn ? auth.getAccessToken : undefined;
  const [result, setResult] = useState<{ organiserId: string; load: Load } | null>(null);
  // Unticked until the member chooses it (Spam Act 2003: emails need their consent), and always sent explicitly.
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState<"follow" | "notify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const returnTo = `/organisers/${encodeURIComponent(organiserId)}`;

  useEffect(() => {
    if (!getToken) return;
    let cancelled = false;
    getFollowStatus(organiserId, getToken).then(
      (follow) => {
        if (cancelled) return;
        setResult({ organiserId, load: { status: "ready", follow } });
        if (follow.following) setNotify(follow.notifyNewEvents);
      },
      (err: unknown) => {
        if (cancelled) return;
        // Not (or no longer) an organiser you can follow: no button. Anything else: offer it anyway.
        if (err instanceof ApiError && err.status === 404) setResult({ organiserId, load: { status: "hidden" } });
        else setResult({ organiserId, load: { status: "ready", follow: { following: false, notifyNewEvents: true } } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organiserId, getToken]);

  if (!auth || auth.status === "loading") return null;

  if (!signedIn || !getToken) {
    return (
      <ButtonLink href={withNext("/login", returnTo)} variant="outline" size="lg" className="w-full sm:w-auto">
        Sign in to follow
      </ButtonLink>
    );
  }

  const load: Load = result?.organiserId === organiserId ? result.load : { status: "loading" };
  if (load.status === "hidden") return null;
  const following = load.status === "ready" && load.follow.following;

  function settle(follow: FollowStatus) {
    setResult({ organiserId, load: { status: "ready", follow } });
  }

  async function toggle() {
    if (busy || load.status !== "ready" || !getToken) return;
    setError(null);
    setBusy("follow");
    try {
      if (following) {
        await unfollowOrganiser(organiserId, getToken);
        settle({ following: false, notifyNewEvents: false });
        setAnnouncement(`You’ve unfollowed ${organiserName}.`);
      } else {
        const follow = await followOrganiser(organiserId, { notifyNewEvents: notify }, getToken);
        settle(follow);
        setAnnouncement(
          follow.notifyNewEvents
            ? `You’re following ${organiserName}. We’ll email you when they announce a new event.`
            : `You’re following ${organiserName}. Their new events show on your home page.`,
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function changeNotify(next: boolean) {
    setNotify(next);
    setError(null);
    if (!following || !getToken) return;
    setBusy("notify");
    try {
      const follow = await followOrganiser(organiserId, { notifyNewEvents: next }, getToken);
      settle(follow);
      setNotify(follow.notifyNewEvents);
      setAnnouncement(follow.notifyNewEvents ? "New-event emails on." : "New-event emails off.");
    } catch (err) {
      setNotify(!next);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3" aria-busy={load.status === "loading" ? true : undefined}>
      <Button
        variant={following ? "outline" : "solid"}
        size="lg"
        aria-pressed={following}
        busy={busy === "follow" || load.status === "loading"}
        onClick={toggle}
        className="w-full sm:w-auto"
      >
        {/* The space outside the hidden suffix, so the name keeps it ("Follow Static Collective"). */}
        <span>
          {following ? "Following" : "Follow"} <span className="sr-only">{organiserName}</span>
        </span>
      </Button>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={notify}
          disabled={load.status !== "ready"}
          aria-disabled={busy === "notify" ? true : undefined}
          onChange={(e) => {
            if (busy !== "notify") void changeNotify(e.target.checked);
          }}
          className="size-5 shrink-0"
        />
        Email me when they announce a new event
      </label>
      {error && <ActionErrorNotice message={error} returnTo={returnTo} />}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
