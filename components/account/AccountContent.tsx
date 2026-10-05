"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Panel } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import AdultCheckbox, { ADULT_ERROR } from "@/components/whos-going/AdultCheckbox";
import DisplayNameField from "@/components/whos-going/DisplayNameField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import SuspendedNotice from "@/components/whos-going/SuspendedNotice";
import { ApiError } from "@/lib/api/client";
import { deleteMyProfile, saveMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { useProfile } from "@/lib/auth/useProfile";
import { endSentence, validateDisplayName } from "@/lib/display-name";
import { withNext } from "@/lib/safe-next-path";

const pillClass = "w-full sm:w-auto";
const linkClass = "underline underline-offset-4 hover:decoration-2";
const PROFILE_INTRO = "This is the name people see when you add yourself to an event's guest list.";
const RETURN_TO = "/account";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return fallback;
}

/** /account: the signed-in email (and signing out), the Who's Going display name, and deleting that profile. */
export default function AccountContent() {
  const auth = useAuth();
  const router = useRouter();
  const { state, setProfile, reload } = useProfile();

  function handleSignOut() {
    auth.signOut();
    router.push("/");
  }

  if (!auth.configured) return <DemoAccount />;
  if (auth.status === "loading") return <p className="text-sm text-muted">Loading your account…</p>;
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

  return (
    <div className="flex flex-col gap-10">
      <Panel title="Signed in as">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base break-words">{auth.email}</p>
            <p className="text-sm text-muted">
              Organising?{" "}
              <Link href="/dashboard" className={linkClass}>
                My events
              </Link>
            </p>
          </div>
          <Button variant="outline" size="lg" onClick={handleSignOut} className={`${pillClass} shrink-0`}>
            Sign out
          </Button>
        </div>
      </Panel>

      {state.status === "loading" && (
        <Panel title="Who's Going profile">
          <p className="text-sm text-muted">Loading your profile…</p>
        </Panel>
      )}

      {state.status === "error" && (
        <Panel title="Who's Going profile">
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              Couldn&rsquo;t load your profile.
            </Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={reload}>
              Try again
            </Button>
          </div>
        </Panel>
      )}

      {state.status === "ready" && (
        <ProfileSections profile={state.profile} onSaved={setProfile} getToken={auth.getAccessToken} />
      )}
    </div>
  );
}

function DemoAccount() {
  return (
    <div className="flex flex-col gap-10">
      <DemoNotice>Accounts aren&rsquo;t available in this demo.</DemoNotice>
      <Panel title="Who's Going profile">
        <p className="mb-5 text-sm text-muted">{PROFILE_INTRO}</p>
        <form className="flex flex-col gap-5" aria-label="Who's Going profile" onSubmit={(e) => e.preventDefault()}>
          <DisplayNameField id="account-name" value="Mia T." onChange={() => {}} disabled />
          <Button type="submit" variant="solid" size="lg" disabled className={pillClass}>
            Save name
          </Button>
        </form>
      </Panel>
    </div>
  );
}

type ProfileNotice = { kind: "created"; name: string } | { kind: "missing" };

function ProfileSections({
  profile,
  onSaved,
  getToken,
}: {
  profile: ProfileRecord | null;
  onSaved: (profile: ProfileRecord | null) => void;
  getToken: () => Promise<string>;
}) {
  const [deleted, setDeleted] = useState(false);
  const deletedRef = useRef<HTMLDivElement>(null);
  // Creating a profile, or finding it gone mid-rename (deleted in another
  // tab), swaps the form out from under the person, so focus goes to the
  // message that explains the new state.
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

  if (!profile) {
    return (
      <Panel title="Who's Going profile">
        <p className="text-sm text-muted">{PROFILE_INTRO}</p>
        <div ref={notice?.kind === "missing" ? noticeRef : undefined} tabIndex={-1} className="mt-3 outline-offset-2">
          <p className="text-sm">
            You haven&rsquo;t set up a profile yet. Create one here, or when you first add yourself to an event.
          </p>
        </div>
        <div className="mt-5">
          <CreateProfileForm
            getToken={getToken}
            onCreated={(created) => {
              onSaved(created);
              setNotice({ kind: "created", name: created.displayName });
            }}
          />
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Panel title="Who's Going profile">
        <p className="mb-5 text-sm text-muted">{PROFILE_INTRO}</p>
        {notice?.kind === "created" && (
          <div ref={noticeRef} tabIndex={-1} className="mb-5 outline-offset-2">
            <Notice role="status">Your profile is set up. You&rsquo;ll be shown as {endSentence(notice.name)}</Notice>
          </div>
        )}
        {profile.suspended && (
          <div className="mb-5">
            <Notice>
              <SuspendedNotice />
            </Notice>
          </div>
        )}
        <RenameForm
          profile={profile}
          onSaved={onSaved}
          onMissing={() => {
            onSaved(null);
            setNotice({ kind: "missing" });
          }}
          getToken={getToken}
        />
      </Panel>

      <Panel title="Messages">
        <p className="text-sm text-muted">
          Conversations with people you&rsquo;ve met on Who&rsquo;s Going, and the people you&rsquo;ve blocked.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-6 text-sm">
          <Link href="/messages" className={`inline-flex min-h-11 items-center ${linkClass}`}>
            Your messages
          </Link>
          <Link href="/messages/blocked" className={`inline-flex min-h-11 items-center ${linkClass}`}>
            Blocked members
          </Link>
        </p>
      </Panel>

      <Panel title="Delete your profile">
        <DeleteProfile
          getToken={getToken}
          onDeleted={() => {
            onSaved(null);
            setDeleted(true);
          }}
        />
        <p className="mt-5 text-xs text-muted">
          To delete your whole account, see our{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </Panel>
    </>
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

function RenameForm({
  profile,
  onSaved,
  onMissing,
  getToken,
}: {
  profile: ProfileRecord;
  onSaved: (profile: ProfileRecord) => void;
  /** The profile has gone (404, e.g. deleted in another tab). */
  onMissing: () => void;
  getToken: () => Promise<string>;
}) {
  const [name, setName] = useState(profile.displayName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function change(value: string) {
    setName(value);
    setSaved(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaved(null);
    const invalid = validateDisplayName(name);
    setFieldError(invalid);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const updated = await saveMyProfile({ displayName: name.trim() }, getToken);
      onSaved(updated);
      setName(updated.displayName);
      setSaved(updated.displayName);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.displayName) {
        setFieldError(err.fieldErrors.displayName);
        inputRef.current?.focus();
      } else if (err instanceof ApiError && err.status === 404) {
        onMissing();
        return;
      } else {
        setError(errorMessage(err, "Couldn't save your name. Try again."));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate aria-label="Who's Going profile" aria-busy={saving} onSubmit={handleSubmit} className="flex flex-col gap-5">
      <DisplayNameField id="account-name" value={name} onChange={change} error={fieldError} inputRef={inputRef} />
      <div className="flex flex-col items-start gap-3">
        {/* busy, not disabled: focus stays on the button through the save. */}
        <Button type="submit" variant="solid" size="lg" busy={saving} className={pillClass}>
          {saving ? "Saving…" : "Save name"}
        </Button>
        {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
        {/* Always mounted so the confirmation is announced when it appears. */}
        <div role="status">
          {saved && <Notice>Saved. Events you&rsquo;ve joined now show {endSentence(saved)}</Notice>}
        </div>
      </div>
    </form>
  );
}

function DeleteProfile({ getToken, onDeleted }: { getToken: () => Promise<string>; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opening the confirm focuses its safe choice (Cancel); cancelling returns
  // focus to "Delete profile". Applied after the swap has rendered.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    // Consumed only once the target exists: the mount's effect can still be
    // pending when the first click sets it, and would otherwise use it up.
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  }, [confirming]);

  async function confirmDelete() {
    if (deleting) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteMyProfile(getToken);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete your profile. Try again."));
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-sm">
        Removes your display name, takes you off every event&rsquo;s Who&rsquo;s Going list and deletes your
        conversations, for you and the people you were talking to. Your tickets and account aren&rsquo;t
        affected.
      </p>
      {confirming ? (
        <div role="group" aria-labelledby="delete-confirm-text" className="flex w-full flex-col gap-3">
          <p id="delete-confirm-text" className="text-sm font-semibold">
            Delete your Who&rsquo;s Going profile?
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            {/* busy, not disabled: after a failure focus is still here to retry. */}
            <Button variant="danger" size="lg" busy={deleting} onClick={confirmDelete} className={pillClass}>
              {deleting ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button
              id="delete-profile-cancel"
              variant="outline"
              size="lg"
              busy={deleting}
              onClick={() => {
                setConfirming(false);
                setError(null);
                pendingFocus.current = "delete-profile";
              }}
              className={pillClass}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          id="delete-profile"
          variant="danger"
          size="lg"
          onClick={() => {
            setConfirming(true);
            pendingFocus.current = "delete-profile-cancel";
          }}
          className={pillClass}
        >
          Delete profile
        </Button>
      )}
      {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
    </div>
  );
}
