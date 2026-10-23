"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { updateMyProfile } from "@/lib/api/profiles";
import type { ProfilePatchInput, ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { handleFromProfileUrl } from "@/lib/organiser-profile";
import AvatarField from "./AvatarField";

/** The server's limit (profiles.bio), counted in code points like the database. */
export const MAX_MEMBER_BIO_LENGTH = 200;
const RETURN_TO = "/account#member-profile";
type Field = "profileVisible" | "bio" | "instagramHandle";
const FIELD_ORDER: readonly Field[] = ["profileVisible", "bio", "instagramHandle"];
const fieldId = (field: Field) => `member-${field}`;

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

/**
 * The member profile settings on /account (docs/architecture.md, "Member
 * profiles"): whether other members can open your profile from Who's Going
 * lists (off by default), a short bio, your Instagram username and a photo.
 * Only what changed is sent (`PATCH /profiles/me`); the photo is saved on its
 * own as soon as it's chosen. A suspended member can't change any of it.
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
      setVisible(updated.profileVisible ?? false);
      setBio(updated.bio ?? "");
      setHandle(updated.instagramHandle ?? "");
      setSaved(
        updated.profileVisible
          ? "Saved. Other members can now open your profile from Who’s Going lists."
          : "Saved. Your profile is hidden: other members see your name only.",
      );
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
    <div className="flex flex-col gap-8">
      <form
        noValidate
        aria-label="Member profile"
        aria-busy={saving}
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId("profileVisible")} className="flex min-h-11 items-start gap-3 text-base sm:text-sm">
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
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="font-semibold">Show my profile to other members</span>
          </label>
          <p id="member-visible-hint" className="pl-8 text-sm text-muted">
            Off by default. When it&rsquo;s on, signed-in members with a Who&rsquo;s Going profile can open yours from
            the lists you&rsquo;re on: your name, bio, Instagram and photo, and the upcoming events you&rsquo;ve added
            yourself to. Never your email. Turn it off any time.
          </p>
          {errors.profileVisible && (
            <p id={`${fieldId("profileVisible")}-error`} className="pl-8 text-sm text-danger">
              {errors.profileVisible}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId("bio")} className="eyebrow text-muted">
            Bio (optional)
          </label>
          <textarea
            id={fieldId("bio")}
            rows={3}
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
            Just your username, without the @. Letters, numbers, . and _, up to 30. Leave it blank to remove it.
          </p>
          {errors.instagramHandle && (
            <p id={`${fieldId("instagramHandle")}-error`} className="text-sm text-danger">
              {errors.instagramHandle}
            </p>
          )}
        </div>

        <div className="flex flex-col items-start gap-3">
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

      <AvatarField profile={profile} getToken={getToken} onSaved={onSaved} onMissing={onMissing} />
    </div>
  );
}
