"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import AdultCheckbox, { ADULT_ERROR } from "@/components/whos-going/AdultCheckbox";
import DisplayNameField from "@/components/whos-going/DisplayNameField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import SuspendedNotice from "@/components/whos-going/SuspendedNotice";
import { ApiError, type GetToken } from "@/lib/api/client";
import { saveMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import type { ProfileState } from "@/lib/auth/useProfile";
import { endSentence, validateDisplayName } from "@/lib/display-name";
import { LoadingState } from "@/components/ui/ProgressLoader";
import MemberProfileSettings from "./MemberProfileSettings";

const pillClass = "w-full sm:w-auto";
export const linkClass = "underline underline-offset-4 hover:decoration-2";
/** A Settings card (Latte's 1120 Settings frames): a 1px border/subtle outline, radius 16, 24px in, 16px between its parts. */
export const settingsCardClass = "flex min-w-0 flex-col gap-4 rounded-card border border-surface-border bg-card p-6";
/** A card's title: Heading/H4, 20/28 at every width. */
export const cardHeadingClass = "heading-h4 max-md:text-xl max-md:leading-7";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return fallback;
}

/** The profile card's title. */
function ProfileHeading() {
  return (
    <h2 id="member-profile-title" className={cardHeadingClass}>
      Your profile
    </h2>
  );
}

/**
 * The Your profile card, on Settings (/account) and on /profile: loading, couldn't load (with Try
 * again), set one up, edit it, or (once deleted from Settings' Privacy card) say so. The caller
 * owns the profile (useProfile), so the page loads it once for everything that reads it.
 * `returnTo`: where a "Sign in" after an expired session comes back to (the page showing the card).
 */
export default function ProfileCard({
  state,
  reload,
  onSaved,
  getToken,
  returnTo,
  deleted = false,
  showMemberPageLink = true,
}: {
  state: ProfileState;
  reload: () => void;
  onSaved: (profile: ProfileRecord | null) => void;
  getToken: GetToken;
  returnTo: string;
  /** The profile was just deleted on this page (Settings' Privacy card). */
  deleted?: boolean;
  /** The card's own link to the member page (off on /profile, whose head has one). */
  showMemberPageLink?: boolean;
}) {
  if (state.status === "loading") {
    return (
      <section className={settingsCardClass} aria-labelledby="member-profile-title">
        <ProfileHeading />
        <LoadingState text="Loading your profile…" />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className={settingsCardClass} aria-labelledby="member-profile-title">
        <ProfileHeading />
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t load your profile.
          </Notice>
          <Button variant="outline" size="sm" className="min-h-11" onClick={reload}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <ProfileSection
      profile={state.profile}
      deleted={deleted}
      onSaved={onSaved}
      getToken={getToken}
      returnTo={returnTo}
      showMemberPageLink={showMemberPageLink}
    />
  );
}

/** The demo's profile card: a sample, disabled form (accounts aren't available without Supabase). */
export function DemoProfileCard() {
  return (
    <section className={settingsCardClass} aria-labelledby="member-profile-title">
      <ProfileHeading />
      <form className="flex flex-col gap-5" aria-label="Your profile" onSubmit={(e) => e.preventDefault()}>
        <div className="flex items-center gap-4">
          <InitialsAvatar name="Mia T." size="field" />
          <p className="text-sm text-muted">Photo (optional)</p>
        </div>
        <DisplayNameField id="account-name" value="Mia T." onChange={() => {}} disabled />
        <Button type="submit" variant="solid" size="sm" disabled className="min-h-11 self-start">
          Save changes
        </Button>
      </form>
    </section>
  );
}

/** The card's anchor: where a sign-in from the photo comes back to (MemberProfileSettings adds it to returnTo). */
const CARD_ID = "member-profile";

type ProfileNotice = { kind: "created"; name: string } | { kind: "missing" };

/**
 * The profile card: set one up, edit it, or (once deleted) say so. Creating a
 * profile, deleting it, or finding it gone mid-save (deleted in another tab)
 * swaps the card's content out from under the person, so focus goes to the
 * message that explains the new state.
 */
function ProfileSection({
  profile,
  deleted,
  onSaved,
  getToken,
  returnTo,
  showMemberPageLink,
}: {
  profile: ProfileRecord | null;
  deleted: boolean;
  onSaved: (profile: ProfileRecord | null) => void;
  getToken: GetToken;
  returnTo: string;
  showMemberPageLink: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const deletedRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<ProfileNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  // Back from signing in to …#member-profile (a "Sign in" after an expired session): the card
  // mounts after the profile loads, too late for the browser's own jump, so focus it once here.
  useEffect(() => {
    if (window.location.hash === `#${CARD_ID}`) sectionRef.current?.focus();
  }, []);
  useEffect(() => {
    if (deleted) deletedRef.current?.focus();
  }, [deleted]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  if (deleted) {
    return (
      <div ref={deletedRef} tabIndex={-1} className="outline-offset-2">
        <Notice role="status">
          Profile deleted.
        </Notice>
      </div>
    );
  }

  const onMissing = () => {
    onSaved(null);
    setNotice({ kind: "missing" });
  };

  return (
    // #member-profile: the card's anchor (the photo's sign-in comes back to it).
    <section
      ref={sectionRef}
      id={CARD_ID}
      tabIndex={-1}
      aria-labelledby="member-profile-title"
      className={`${settingsCardClass} scroll-mt-24 outline-offset-2`}
    >
      <ProfileHeading />
      {profile ? (
        <>
          {notice?.kind === "created" && (
            <div ref={noticeRef} tabIndex={-1} className="mb-4 outline-offset-2">
              <Notice role="status">You&rsquo;ll be shown as {endSentence(notice.name)}</Notice>
            </div>
          )}
          {profile.suspended && (
            <div className="mb-4">
              <Notice>
                <SuspendedNotice />
              </Notice>
            </div>
          )}
          <MemberProfileSettings
            profile={profile}
            getToken={getToken}
            onSaved={onSaved}
            onMissing={onMissing}
            returnTo={returnTo}
            showMemberPageLink={showMemberPageLink}
          />
        </>
      ) : (
        <>
          <div ref={notice?.kind === "missing" ? noticeRef : undefined} tabIndex={-1} className="outline-offset-2">
            <p className="text-sm">No profile yet.</p>
          </div>
          <div className="mt-4">
            <CreateProfileForm
              getToken={getToken}
              returnTo={returnTo}
              onCreated={(created) => {
                onSaved(created);
                setNotice({ kind: "created", name: created.displayName });
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** First-time setup: a display name and the 18+ confirmation. Joins no event. */
function CreateProfileForm({
  getToken,
  returnTo,
  onCreated,
}: {
  getToken: GetToken;
  returnTo: string;
  onCreated: (profile: ProfileRecord) => void;
}) {
  const [name, setName] = useState("");
  const [adult, setAdult] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [adultError, setAdultError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const adultRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const nextNameError = validateDisplayName(name);
    const nextAdultError = adult ? null : ADULT_ERROR;
    setNameError(nextNameError);
    setAdultError(nextAdultError);
    if (nextNameError || nextAdultError) {
      (nextNameError ? nameRef : adultRef).current?.focus();
      return;
    }
    setSaving(true);
    try {
      onCreated(await saveMyProfile({ displayName: name.trim(), adultConfirmed: true }, getToken));
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : undefined;
      if (fieldErrors?.displayName || fieldErrors?.adultConfirmed) {
        setNameError(fieldErrors.displayName ?? null);
        setAdultError(fieldErrors.adultConfirmed ? ADULT_ERROR : null);
        (fieldErrors.displayName ? nameRef : adultRef).current?.focus();
      } else {
        setError(errorMessage(err, "Couldn't create your profile. Try again."));
      }
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      aria-label="Create your Who's Going profile"
      aria-busy={saving}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <DisplayNameField id="account-name" value={name} onChange={setName} error={nameError} inputRef={nameRef} />
      <AdultCheckbox id="account-adult" checked={adult} onChange={setAdult} error={adultError} inputRef={adultRef} />
      <p id="account-create-consent" className="text-sm leading-5">
        Shown only on events you join, to signed-in members, with the same name on each.{" "}
        <Link href="/privacy#whos-going" className={linkClass}>
          How we handle your information
        </Link>
      </p>
      <div className="flex flex-col items-start gap-3">
        <Button
          type="submit"
          variant="solid"
          size="lg"
          busy={saving}
          aria-describedby="account-create-consent"
          className={pillClass}
        >
          {saving ? "Creating…" : "Create profile"}
        </Button>
        {error && <ActionErrorNotice message={error} returnTo={returnTo} />}
      </div>
    </form>
  );
}
