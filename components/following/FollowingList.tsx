"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { followOrganiser, listFollowing, unfollowOrganiser } from "@/lib/api/follows";
import type { FollowedOrganiser } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { formatDayWithYear } from "@/lib/format";
import { withNext } from "@/lib/safe-next-path";

const RETURN_TO = "/following";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: FollowedOrganiser[]; nextCursor?: string };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500))) return err.message;
  return fallback;
}

const rowHeadingId = (organiserId: string) => `following-${organiserId}`;

/**
 * /following: the organisers you follow, most recent first, each with its
 * new-event email choice and Unfollow. Unfollowing takes the row away and
 * moves focus to the next one (or the list's heading), saying what happened.
 */
export default function FollowingList() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const signedIn = auth.status === "signed-in";
  const [attempt, setAttempt] = useState(0);
  const key = `${auth.email ?? ""}#${attempt}`;
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  const load: Load = result?.key === key ? result.load : { status: "loading" };
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | "heading" | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    listFollowing(getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, load: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled)
          setResult({ key, load: { status: "error", message: errorMessage(err, "Couldn’t load the organisers you follow.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, getToken, key]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "heading" ? headingRef.current : document.getElementById(target);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  if (!auth.configured) {
    return <DemoNotice>Following organisers isn&rsquo;t available in this demo.</DemoNotice>;
  }
  if (auth.status === "loading") return <LoadingState text="Loading…" />;
  if (!signedIn) {
    return (
      <EmptyState
        title="Sign in to see who you follow"
        action={
          <ButtonLink size="lg" href={withNext("/login", RETURN_TO)}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  function update(change: (items: FollowedOrganiser[]) => FollowedOrganiser[], nextCursor?: string | null) {
    setResult((current) =>
      current && current.key === key && current.load.status === "ready"
        ? {
            key,
            load: {
              status: "ready",
              items: change(current.load.items),
              nextCursor: nextCursor === undefined ? current.load.nextCursor : (nextCursor ?? undefined),
            },
          }
        : current,
    );
  }

  function unfollowed(item: FollowedOrganiser) {
    if (load.status !== "ready") return;
    const index = load.items.findIndex((i) => i.organiserId === item.organiserId);
    const next = load.items[index + 1] ?? load.items[index - 1];
    update((items) => items.filter((i) => i.organiserId !== item.organiserId));
    setAnnouncement(`You’ve unfollowed ${item.displayName}.`);
    pendingFocus.current = next ? rowHeadingId(next.organiserId) : "heading";
  }

  async function loadMore() {
    if (load.status !== "ready" || !load.nextCursor || moreBusy) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await listFollowing(getToken, load.nextCursor);
      const known = new Set(load.items.map((i) => i.organiserId));
      const fresh = page.items.filter((i) => !known.has(i.organiserId));
      update((items) => [...items, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = rowHeadingId(fresh[0].organiserId);
    } catch (err) {
      setMoreError(errorMessage(err, "Couldn’t load more."));
    } finally {
      setMoreBusy(false);
    }
  }

  return (
    <section aria-labelledby="following-heading" aria-busy={load.status === "loading" ? true : undefined}>
      <h2 id="following-heading" ref={headingRef} tabIndex={-1} className="font-heading mb-4 text-xl leading-6 outline-offset-2">
        Organisers
      </h2>
      {load.status === "loading" && <LoadingState text="Loading the organisers you follow…" />}
      {load.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <ActionErrorNotice message={load.message} returnTo={RETURN_TO} />
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {load.status === "ready" && load.items.length === 0 && (
        <EmptyState
          title="You’re not following anyone yet"
          action={
            <ButtonLink href="/events" size="lg" variant="outline">
              Browse events
            </ButtonLink>
          }
        >
          Follow an organiser from their page, and their new events show on your home page.
        </EmptyState>
      )}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="flex flex-col">
          {load.items.map((item) => (
            <FollowedRow
              key={item.organiserId}
              item={item}
              getToken={getToken}
              onChanged={(changed) => update((items) => items.map((i) => (i.organiserId === changed.organiserId ? changed : i)))}
              onUnfollowed={unfollowed}
              onAnnounce={setAnnouncement}
            />
          ))}
        </ul>
      )}
      {load.status === "ready" && load.nextCursor && (
        <div className="mt-6 flex flex-col items-start gap-3">
          {moreError && <Notice tone="danger">{moreError}</Notice>}
          <Button variant="outline" busy={moreBusy} onClick={loadMore} className="min-h-11">
            {moreBusy ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

function FollowedRow({
  item,
  getToken,
  onChanged,
  onUnfollowed,
  onAnnounce,
}: {
  item: FollowedOrganiser;
  getToken: GetToken;
  onChanged: (item: FollowedOrganiser) => void;
  onUnfollowed: (item: FollowedOrganiser) => void;
  onAnnounce: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"notify" | "unfollow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = `following-notify-${item.organiserId}`;

  async function setNotify(next: boolean) {
    if (busy) return;
    setBusy("notify");
    setError(null);
    try {
      const status = await followOrganiser(item.organiserId, { notifyNewEvents: next }, getToken);
      onChanged({ ...item, notifyNewEvents: status.notifyNewEvents });
      onAnnounce(
        status.notifyNewEvents
          ? `We’ll email you when ${item.displayName} announces a new event.`
          : `No more new-event emails from ${item.displayName}.`,
      );
    } catch (err) {
      setError(errorMessage(err, "Couldn’t change that. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function unfollow() {
    if (busy) return;
    setBusy("unfollow");
    setError(null);
    try {
      await unfollowOrganiser(item.organiserId, getToken);
      onUnfollowed(item);
    } catch (err) {
      setError(errorMessage(err, "Couldn’t unfollow. Try again."));
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 border-t border-foreground py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={rowHeadingId(item.organiserId)} tabIndex={-1} className="text-base font-semibold break-words outline-offset-2">
          <Link
            href={`/organisers/${encodeURIComponent(item.organiserId)}`}
            className="underline-offset-4 hover:underline"
          >
            {item.displayName}
          </Link>
        </h3>
        <p className="meta text-muted">Following since {formatDayWithYear(item.followedAt)}</p>
        <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            id={checkboxId}
            type="checkbox"
            checked={item.notifyNewEvents}
            aria-disabled={busy ? true : undefined}
            onChange={(e) => void setNotify(e.target.checked)}
            className="size-5 shrink-0"
          />
          Email me when they announce a new event
        </label>
        {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      </div>
      <Button variant="outline" size="md" busy={busy === "unfollow"} onClick={unfollow} className="min-h-11 shrink-0 sm:self-start">
        <span>
          {busy === "unfollow" ? "Unfollowing…" : "Unfollow"} <span className="sr-only">{item.displayName}</span>
        </span>
      </Button>
    </li>
  );
}
