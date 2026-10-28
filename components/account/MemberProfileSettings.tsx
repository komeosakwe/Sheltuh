"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import DisplayNameField from "@/components/whos-going/DisplayNameField";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { updateMyProfile } from "@/lib/api/profiles";
import type { ProfilePatchInput, ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { endSentence, validateDisplayName } from "@/lib/display-name";
import { handleFromProfileUrl } from "@/lib/organiser-profile";
import AvatarField from "./AvatarField";

/** The server's limit (profiles.bio), counted in code points like the database. */
export const MAX_MEMBER_BIO_LENGTH = 200;
const RETURN_TO = "/account";
type Field = "displayName" | "bio" | "instagramHandle" | "profileVisible";
/** In the form's order, so the first error focused is the first one on screen. */
const FIELD_ORDER: readonly Field[] = ["displayName", "bio", "instagramHandle", "profileVisible"];
// The display name keeps the id it had in its own form (DisplayNameField derives its hint, count and error ids from it).
const fieldId = (field: Field) => (field === "displayName" ? "account-name" : `member-${field}`);

const length = (text: string) => Array.from(text).length;

function errorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return "Couldn’t save your profile. Try again.";
}

/** A typed handle as sent: trimmed, a pasted instagram.com/name link reduced to the name, "" to clear. */
function handleForRequest(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return handleFromProfileUrl("instagramHandle", trimmed) ?? trimmed;
}

/** What a save confirms: the new name if it changed, and where the profile now stands if any of it did. */
function savedMessage(input: ProfilePatchInput, updated: ProfileRecord): string {
  const parts = ["Saved."];
  if (input.displayName !== undefined) parts.push(`Events you’ve joined now show ${endSentence(updated.displayName)}`);
  if (input.profileVisible !== undefined || input.bio !== undefined || input.instagramHandle !== undefined) {
    parts.push(
      updated.profileVisible
        ? "Other members can now open your profile from Who’s Going lists."
        : "Your profile is hidden: other members see your name only.",
    );
  }
  return parts.join(" ");
}

/**
 * The profile card's settings on /account (docs/architecture.md, "Member
 * profiles"): the photo, then one form for the display name, a short bio,
 * your Instagram username and whether other members can open your profile
 * from Who's Going lists (off by default). One Save sends only what changed,
 * in one `PATCH /profiles/me` (it takes the name too), so the name and the
 * rest are saved together and the API's errors land on their own fields. The
 * photo is saved on its own as soon as it's chosen. A suspended member can't
 * change any of it.
 */
export default function MemberProfileSettings({
  profile,
  getToken,
  onSaved,
  onMissing,
}: {
  profile: ProfileRecord;
  getToken: GetToken;
  onSaved: (profile: ProfileRecord) => void;
  /** The profile has gone (404, e.g. deleted in another tab). */
  onMissing: () => void;
}) {
  const [name, setName] = useState(profile.displayName);
  const [visible, setVisible] = useState(profile.profileVisible ?? false);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [handle, setHandle] = useState(profile.instagramHandle ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const focusFirstError = useRef(false);

  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }, [errors]);

  function edited() {
    setSaved(null);
  }

  function changes(): ProfilePatchInput {
    const input: ProfilePatchInput = {};
    const nextName = name.trim();
    if (nextName !== profile.displayName) input.displayName = nextName;
    if (visible !== (profile.profileVisible ?? false)) input.profileVisible = visible;
    const nextBio = bio.trim() || null;
    if (nextBio !== (profile.bio ?? null)) input.bio = nextBio;
    const nextHandle = handleForRequest(handle);
    if (nextHandle !== (profile.instagramHandle ?? null)) input.instagramHandle = nextHandle;
    return input;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaved(null);
    const nextErrors: Partial<Record<Field, string>> = {};
    const nameError = validateDisplayName(name);
    if (nameError) nextErrors.displayName = nameError;
    if (length(bio.trim()) > MAX_MEMBER_BIO_LENGTH) {
      nextErrors.bio = `Your bio must be ${MAX_MEMBER_BIO_LENGTH} characters or fewer.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError.current = true;
      return;
    }
    const input = changes();
    if (Object.keys(input).length === 0) {
      setSaved("No changes to save.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateMyProfile(input, getToken);
      onSaved(updated);
      setName(updated.displayName);
      setVisible(updated.profileVisible ?? false);
      setBio(updated.bio ?? "");
      setHandle(updated.instagramHandle ?? "");
      setSaved(savedMessage(input, updated));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onMissing();
        return;
      }
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : undefined;
      const known = FIELD_ORDER.filter((field) => fieldErrors?.[field]);
      if (fieldErrors && known.length > 0) {
        setErrors(Object.fromEntries(known.map((field) => [field, fieldErrors[field]])));
        focusFirstError.current = true;
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  if (profile.suspended) {
    return <p className="text-sm text-muted">Suspended profiles can&rsquo;t be changed or shown to other members.</p>;
  }

  const bioLeft = MAX_MEMBER_BIO_LENGTH - length(bio);
  const describedBy = (field: Field, ...notes: string[]) =>
    [...notes, errors[field] ? `${fieldId(field)}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-5">
      <AvatarField profile={profile} getToken={getToken} onSaved={onSaved} onMissing={onMissing} />

      <form
        noValidate
        aria-label="Your profile"
        aria-busy={saving}
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <DisplayNameField
          id={fieldId("displayName")}
          value={name}
          onChange={(value) => {
            setName(value);
            edited();
          }}
          error={errors.displayName}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId("bio")} className="eyebrow text-muted">
            Bio (optional)
          </label>
          <textarea
            id={fieldId("bio")}
            rows={2}
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              edited();
            }}
            aria-invalid={errors.bio ? true : undefined}
            aria-describedby={describedBy("bio", "member-bio-count")}
            className={fieldClass}
          />
          <p id="member-bio-count" className={`text-xs tabular-nums ${bioLeft < 0 ? "text-danger" : "text-muted"}`}>
            {bioLeft >= 0 ? `${bioLeft} of ${MAX_MEMBER_BIO_LENGTH} characters left` : `${-bioLeft} characters too many`}
          </p>
          {errors.bio && (
            <p id={`${fieldId("bio")}-error`} className="text-sm text-danger">
              {errors.bio}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId("instagramHandle")} className="eyebrow text-muted">
            Instagram username (optional)
          </label>
          <input
            id={fieldId("instagramHandle")}
            value={handle}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setHandle(e.target.value);
              edited();
            }}
            aria-invalid={errors.instagramHandle ? true : undefined}
            aria-describedby={describedBy("instagramHandle", "member-instagram-hint")}
            className={fieldClass}
          />
          <p id="member-instagram-hint" className="text-xs text-muted">
            Without the @.
          </p>
          {errors.instagramHandle && (
            <p id={`${fieldId("instagramHandle")}-error`} className="text-sm text-danger">
              {errors.instagramHandle}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId("profileVisible")} className="flex min-h-11 items-center gap-3 text-base sm:text-sm">
            <input
              id={fieldId("profileVisible")}
              type="checkbox"
              checked={visible}
              onChange={(e) => {
                setVisible(e.target.checked);
                edited();
              }}
              aria-describedby={describedBy("profileVisible", "member-visible-hint")}
              aria-invalid={errors.profileVisible ? true : undefined}
              className="size-5 shrink-0"
            />
            <span className="font-semibold">Show my profile to other members</span>
          </label>
          <p id="member-visible-hint" className="pl-8 text-xs text-muted">
            Off by default. Members on your Who&rsquo;s Going lists can then see your bio, Instagram, photo and
            upcoming events. Never your email.
          </p>
          {errors.profileVisible && (
            <p id={`${fieldId("profileVisible")}-error`} className="pl-8 text-sm text-danger">
              {errors.profileVisible}
            </p>
          )}
        </div>

        <div className="flex flex-col items-start gap-3">
          {/* busy, not disabled: focus stays on the button through the save. */}
          <Button type="submit" variant="solid" size="lg" busy={saving} className="w-full sm:w-auto">
            {saving ? "Saving…" : "Save profile"}
          </Button>
          {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
          {/* Always mounted so the result is announced when it appears. */}
          <div role="status">{saved && <Notice>{saved}</Notice>}</div>
          {profile.profileVisible && profile.profileId && (
            <Link
              href={`/members/${encodeURIComponent(profile.profileId)}`}
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:decoration-2"
            >
              See your profile as members see it
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
