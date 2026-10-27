"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import AdultCheckbox, { ADULT_ERROR } from "@/components/whos-going/AdultCheckbox";
import DisplayNameField from "@/components/whos-going/DisplayNameField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import SuspendedNotice from "@/components/whos-going/SuspendedNotice";
import { ApiError } from "@/lib/api/client";
import { saveMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { signInMethodsLabel } from "@/lib/auth/oauth";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { useProfile } from "@/lib/auth/useProfile";
import { endSentence, validateDisplayName } from "@/lib/display-name";
import { withNext } from "@/lib/safe-next-path";
import { LoadingState } from "@/components/ui/ProgressLoader";
import AccountLinks from "./AccountLinks";
import DeleteProfile from "./DeleteProfile";
import MemberProfileSettings from "./MemberProfileSettings";

const pillClass = "w-full sm:w-auto";
const linkClass = "underline underline-offset-4 hover:decoration-2";
const sectionClass = "border-t border-foreground pt-4";
const headingClass = "font-heading text-xl leading-6";
const RETURN_TO = "/account";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return fallback;
}

/**
 * The card's heading and one-line intro, with the privacy link (`privacyLink`
 * false where the form below has its own, beside its consent line).
 */
function ProfileHeading({ privacyLink = true }: { privacyLink?: boolean }) {
  return (
    <>
      <h2 id="member-profile-title" className={headingClass}>
        Your profile
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        How you show on Who&rsquo;s Going lists.
        {privacyLink && (
          <>
            {" "}
            <Link href="/privacy#whos-going" className={linkClass}>
              How we handle your information
            </Link>
          </>
        )}
      </p>
    </>
  );
}

/**
 * /account, compact and profile first: Your profile (photo, display name,
 * bio, Instagram, the visibility switch: one Save), a list of link rows
 * (Your events for organisers, Organisers you follow, Messages, Blocked
 * members), Sign-in (the email and how it signs in, Sign out), and Delete
 * your profile behind a disclosure.
 */
export default function AccountContent() {
  const auth = useAuth();
  const router = useRouter();
  const { state, setProfile, reload } = useProfile();
  const organiser = useOrganiser();
  // How this account signs in (Apple's guidelines: show it). Text only, no logos.
  const signInMethods = signInMethodsLabel(auth.providers);
  const [deleted, setDeleted] = useState(false);

  function handleSignOut() {
    auth.signOut();
    router.push("/");
  }

  if (!auth.configured) return <DemoAccount />;
  if (auth.status === "loading") return <LoadingState text="Loading your account…" />;
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        title="Sign in to manage your account"
        action={
          <ButtonLink size="lg" href={withNext("/login", RETURN_TO)}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  // Organisers (any application on file) get Your events. If their status
  // couldn't be loaded, the row stays: the dashboard explains itself.
  const showEvents = !organiser.loading && (organiser.organiser !== null || organiser.error !== null);
  const profile = state.status === "ready" ? state.profile : null;

  return (
    <div className="flex flex-col gap-8">
      {state.status === "loading" && (
        <section className={sectionClass} aria-labelledby="member-profile-title">
          <ProfileHeading />
          <LoadingState text="Loading your profile…" />
        </section>
      )}

      {state.status === "error" && (
        <section className={sectionClass} aria-labelledby="member-profile-title">
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
      )}

      {state.status === "ready" && (
        <ProfileSection profile={state.profile} deleted={deleted} onSaved={setProfile} getToken={auth.getAccessToken} />
      )}

      <AccountLinks showEvents={showEvents} />

      <section className={sectionClass} aria-labelledby="sign-in-title">
        <h2 id="sign-in-title" className={headingClass}>
          Sign-in
        </h2>
        <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-muted">
            <span>Signed in as </span>
            <span className="break-words text-foreground">{auth.email}</span>
            {signInMethods && (
              <>
                {/* One line from 640px; on a phone the methods start their own. */}
                <span aria-hidden="true" className="hidden sm:inline">
                  {" "}
                  ·{" "}
                </span>
                <span className="block sm:inline">Sign-in methods: {signInMethods}</span>
              </>
            )}
          </p>
          <Button variant="outline" size="md" onClick={handleSignOut} className="min-h-11 shrink-0">
            Sign out
          </Button>
        </div>
      </section>

      <section className={sectionClass}>
        {profile && !deleted && (
          <DeleteProfile
            getToken={auth.getAccessToken}
            onDeleted={() => {
              setProfile(null);
              setDeleted(true);
            }}
          />
        )}
        <p className={`text-xs text-muted ${profile && !deleted ? "mt-2" : ""}`.trim()}>
          To delete your whole account, see our{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function DemoAccount() {
  return (
    <div className="flex flex-col gap-8">
      <DemoNotice>Accounts aren&rsquo;t available in this demo.</DemoNotice>
      <section className={sectionClass} aria-labelledby="member-profile-title">
        <ProfileHeading />
        <form className="flex flex-col gap-5" aria-label="Your profile" onSubmit={(e) => e.preventDefault()}>
          <div className="flex items-center gap-4">
            <InitialsAvatar name="Mia T." size="field" />
            <p className="text-sm text-muted">Photo (optional)</p>
          </div>
          <DisplayNameField id="account-name" value="Mia T." onChange={() => {}} disabled />
          <Button type="submit" variant="solid" size="lg" disabled className={pillClass}>
            Save profile
          </Button>
        </form>
      </section>
    </div>
  );
}

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
}: {
  profile: ProfileRecord | null;
  deleted: boolean;
  onSaved: (profile: ProfileRecord | null) => void;
  getToken: () => Promise<string>;
}) {
  const deletedRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<ProfileNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

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
          Your profile is deleted. You&rsquo;re no longer shown on any event, and your conversations are gone.
        </Notice>
      </div>
    );
  }

  const onMissing = () => {
    onSaved(null);
    setNotice({ kind: "missing" });
  };

  return (
    // #member-profile: where "Edit your profile" on a member page lands.
    <section
      id="member-profile"
      tabIndex={-1}
      aria-labelledby="member-profile-title"
      className={`${sectionClass} scroll-mt-24 outline-offset-2`}
    >
      <ProfileHeading privacyLink={profile !== null} />
      {profile ? (
        <>
          {notice?.kind === "created" && (
            <div ref={noticeRef} tabIndex={-1} className="mb-4 outline-offset-2">
              <Notice role="status">Your profile is set up. You&rsquo;ll be shown as {endSentence(notice.name)}</Notice>
            </div>
          )}
          {profile.suspended && (
            <div className="mb-4">
              <Notice>
                <SuspendedNotice />
              </Notice>
            </div>
          )}
          <MemberProfileSettings profile={profile} getToken={getToken} onSaved={onSaved} onMissing={onMissing} />
        </>
      ) : (
        <>
          <div ref={notice?.kind === "missing" ? noticeRef : undefined} tabIndex={-1} className="outline-offset-2">
            <p className="text-sm">
              You haven&rsquo;t set up a profile yet. Create one here, or when you first add yourself to an event.
            </p>
          </div>
          <div className="mt-4">
            <CreateProfileForm
              getToken={getToken}
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

/** First-time setup from /account: a display name and the 18+ confirmation. Joins no event. */
function CreateProfileForm({
  getToken,
  onCreated,
}: {
  getToken: () => Promise<string>;
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
        Your name is only shown on events you add yourself to, to people signed in to Sheltüh, and it&rsquo;s the
        same on each of them.{" "}
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
        {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      </div>
    </form>
  );
}
