"use client";

import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { useAvatarObjectUrl } from "@/components/members/useAvatarObjectUrl";
import { Button, buttonClass } from "@/components/ui/Button";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { deleteMyAvatar, uploadMyAvatar } from "@/lib/api/profiles";
import type { ProfileRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";

/** What the API takes (docs/architecture.md, "Member profiles": sniffed from the bytes, at most 5 MB). */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const RETURN_TO = "/account#member-profile";

/** Checked before anything is sent; the server checks again (and decides by the bytes, not the name). */
export function avatarFileError(file: File): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Choose a JPEG, PNG or WebP photo.";
  if (file.size > MAX_AVATAR_BYTES) return "That photo is over 5 MB. Choose a smaller one.";
  if (file.size === 0) return "That file is empty. Choose another photo.";
  return null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status === 413) return "That photo is over 5 MB. Choose a smaller one.";
  if (err instanceof ApiError && err.status === 429) return "You’ve changed your photo a lot today. Try again tomorrow.";
  if (err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500))) return err.message;
  return fallback;
}

type Busy = { kind: "upload"; preview: string } | { kind: "remove" } | null;

/**
 * The member photo: a preview (the saved photo, fetched with the token, or
 * initials), a file picker styled as a button (the native input, visually
 * hidden but focusable, so it works from the keyboard and screen readers),
 * and Remove. A chosen photo is checked here (type and size), shown at once
 * as a preview while it uploads, then replaced by what the server stored (it
 * re-encodes it square and strips camera and location data). Upload progress
 * isn't measurable through the API client, so "Uploading…" is said, not a
 * percentage.
 */
export default function AvatarField({
  profile,
  getToken,
  onSaved,
  onMissing,
}: {
  profile: ProfileRecord;
  getToken: GetToken;
  onSaved: (profile: ProfileRecord) => void;
  onMissing: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const saved = useAvatarObjectUrl(profile.hasAvatar ? profile.avatarUrl : undefined, getToken);
  const shown = busy?.kind === "upload" ? busy.preview : saved;

  // The local preview of a chosen photo is an object URL: revoke it when it's replaced.
  const preview = busy?.kind === "upload" ? busy.preview : null;
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function pick(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file || busy) return;
    setError(null);
    setStatus("");
    const invalid = avatarFileError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy({ kind: "upload", preview: URL.createObjectURL(file) });
    setStatus("Uploading your photo…");
    try {
      const updated = await uploadMyAvatar(file, getToken);
      onSaved(updated);
      setStatus("Photo saved.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onMissing();
        return;
      }
      setError(errorMessage(err, "Couldn’t upload that photo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setError(null);
    setBusy({ kind: "remove" });
    setStatus("Removing your photo…");
    try {
      await deleteMyAvatar(getToken);
      onSaved({ ...profile, hasAvatar: false, avatarUrl: undefined, avatarThumbUrl: undefined });
      setStatus("Photo removed.");
      inputRef.current?.focus();
    } catch (err) {
      setError(errorMessage(err, "Couldn’t remove your photo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  const hasPhoto = Boolean(profile.hasAvatar);

  return (
    <div className="flex flex-col gap-3 border-t border-surface-border pt-6" aria-busy={busy ? true : undefined}>
      <p id="member-photo-title" className="eyebrow text-muted">
        Photo (optional)
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative size-24 shrink-0 sm:size-32">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL (the photo needs the bearer token)
            <img
              src={shown}
              alt={busy?.kind === "upload" ? "Your new photo, uploading" : "Your profile photo"}
              className={`size-full rounded-dot object-cover ${busy?.kind === "upload" ? "opacity-60" : ""}`}
            />
          ) : (
            <InitialsAvatar name={profile.displayName} size="lg" />
          )}
        </div>
        <div className="flex flex-col items-start gap-3">
          <input
            ref={inputRef}
            id="member-photo"
            type="file"
            accept={AVATAR_TYPES.join(",")}
            // Not disabled while busy (that would drop focus from it): a pick then is ignored.
            aria-disabled={busy ? true : undefined}
            onChange={(e) => pick(e.target.files?.[0])}
            aria-labelledby="member-photo-title member-photo-pick"
            aria-describedby="member-photo-hint"
            className="peer sr-only"
          />
          <label
            id="member-photo-pick"
            htmlFor="member-photo"
            className={buttonClass(
              "outline",
              "md",
              `min-h-11 cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground ${
                busy ? "pointer-events-none border-surface-border bg-surface text-muted" : ""
              }`,
            )}
          >
            {hasPhoto ? "Change photo" : "Choose a photo"}
          </label>
          <p id="member-photo-hint" className="max-w-sm text-xs text-muted">
            JPEG, PNG or WebP, up to 5 MB. We crop it square and remove everything stored in the file (camera details,
            location) before saving it. Only members who can see your profile see it.
          </p>
          {busy?.kind === "upload" && <DotsLoader label="Uploading" />}
          {hasPhoto && busy?.kind !== "upload" && (
            <Button variant="outline" size="md" busy={busy?.kind === "remove"} onClick={remove} className="min-h-11">
              {busy?.kind === "remove" ? "Removing…" : "Remove photo"}
            </Button>
          )}
        </div>
      </div>
      {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
