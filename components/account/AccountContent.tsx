"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, Panel } from "@/components/ui/Section";
import DisplayNameField from "@/components/whos-going/DisplayNameField";
import { ApiError } from "@/lib/api/client";
import { deleteMyProfile, saveMyProfile } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { useProfile } from "@/lib/auth/useProfile";
import { validateDisplayName } from "@/lib/display-name";

const pillClass = "w-full sm:w-auto";
const linkClass = "underline underline-offset-4 hover:decoration-2";
const PROFILE_INTRO = "This is the name people see when you add yourself to an event's guest list.";

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof SessionExpiredError) return "Your session has expired. Sign in again to continue.";
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return fallback;
}

/** /account: the signed-in email, the Who's Going display name, and deleting that profile. */
export default function AccountContent() {
  const auth = useAuth();
  const { state, setProfile, reload } = useProfile();

  if (!auth.configured) return <DemoAccount />;
  if (auth.status === "loading") return <p className="text-sm text-muted">Loading your account…</p>;
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        title="Sign in to manage your account"
        action={
          <ButtonLink size="lg" href="/login?next=%2Faccount">
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <Panel title="Signed in as">
        <p className="text-base break-words">{auth.email}</p>
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

  // Deleting replaces both sections, so focus goes to the confirmation.
  useEffect(() => {
    if (deleted) deletedRef.current?.focus();
  }, [deleted]);

  if (deleted) {
    return (
      <div ref={deletedRef} tabIndex={-1} className="outline-offset-2">
        <Notice role="status">Your profile is deleted. You&rsquo;re no longer shown on any event.</Notice>
      </div>
    );
  }

  if (!profile) {
    return (
      <Panel title="Who's Going profile">
        <p className="text-sm text-muted">{PROFILE_INTRO}</p>
        <p className="mt-3 text-sm">
          You haven&rsquo;t added yourself to an event yet. Your profile is created the first time you do.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <Panel title="Who's Going profile">
        <p className="mb-5 text-sm text-muted">{PROFILE_INTRO}</p>
        {profile.suspended && (
          <div className="mb-5">
            <Notice>
              Your display name is hidden from Who&rsquo;s Going. If you think that&rsquo;s a mistake, email{" "}
              <a href="mailto:support@sheltuh.com.au" className={linkClass}>
                support@sheltuh.com.au
              </a>
              .
            </Notice>
          </div>
        )}
        <RenameForm profile={profile} onSaved={onSaved} getToken={getToken} />
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

function RenameForm({
  profile,
  onSaved,
  getToken,
}: {
  profile: ProfileRecord;
  onSaved: (profile: ProfileRecord) => void;
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
        <Button type="submit" variant="solid" size="lg" disabled={saving} className={pillClass}>
          {saving ? "Saving…" : "Save name"}
        </Button>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {/* Always mounted so the confirmation is announced when it appears. */}
        <div role="status">{saved && <Notice>Saved. Events you&rsquo;ve joined now show {saved}.</Notice>}</div>
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
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [confirming]);

  async function confirmDelete() {
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
        Removes your display name and takes you off every event&rsquo;s Who&rsquo;s Going list. Your tickets
        and account aren&rsquo;t affected.
      </p>
      {confirming ? (
        <div role="group" aria-labelledby="delete-confirm-text" className="flex w-full flex-col gap-3">
          <p id="delete-confirm-text" className="text-sm font-semibold">
            Delete your Who&rsquo;s Going profile?
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="danger" size="lg" disabled={deleting} onClick={confirmDelete} className={pillClass}>
              {deleting ? "Deleting…" : "Yes, delete"}
            </Button>
            <Button
              id="delete-profile-cancel"
              variant="outline"
              size="lg"
              disabled={deleting}
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
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
