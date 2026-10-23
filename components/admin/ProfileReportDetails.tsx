"use client";

import { useEffect, useRef, useState } from "react";
import MessageField from "@/components/messages/MessageField";
import { useAvatarObjectUrl } from "@/components/members/useAvatarObjectUrl";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { adminGetMemberProfile, adminRemoveProfileContent } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminMemberProfile, AdminReport, ProfileContentField } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";

export const PROFILE_FIELD_LABELS: Record<ProfileContentField, string> = {
  avatar: "Photo",
  bio: "Bio",
  instagram: "Instagram",
};
const FIELDS: readonly ProfileContentField[] = ["avatar", "bio", "instagram"];

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/** "Photo and bio", "Photo, bio and Instagram". */
function listFields(fields: readonly ProfileContentField[]): string {
  const words = fields.map((f, i) => (i === 0 ? PROFILE_FIELD_LABELS[f] : PROFILE_FIELD_LABELS[f].toLowerCase()));
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * A profile report's evidence and moderation (docs/architecture.md, "Member
 * profiles"): the copies taken when it was reported (photo, fetched with the
 * admin's token from the report's own copy; bio; Instagram handle), the
 * member's current profile and its moderation log on request, and removing
 * their photo, bio or Instagram with a reason (logged, never the content).
 * Everything is member-supplied text, shown as text.
 */
export default function ProfileReportDetails({ report, getToken }: { report: AdminReport; getToken: GetToken }) {
  const photo = useAvatarObjectUrl(report.reportedAvatarUrl, getToken);
  const profileId = report.reportedProfileId;
  const hasCopies = Boolean(report.reportedAvatarUrl || report.reportedBio || report.reportedInstagramHandle);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="eyebrow text-muted">Reported profile (as it was)</p>
        {hasCopies ? (
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
            {report.reportedAvatarUrl && (
              <div className="size-24 shrink-0 bg-surface">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL (admin-only photo copy)
                  <img src={photo} alt="Reported profile photo" className="size-full rounded-dot object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center px-2 text-center text-xs text-muted">
                    Loading photo…
                  </span>
                )}
              </div>
            )}
            <dl className="flex min-w-0 flex-col gap-2 text-sm">
              <div>
                <dt className="text-muted">Bio</dt>
                <dd className="break-words whitespace-pre-wrap">
                  {report.reportedBio ?? <span className="text-muted italic">None</span>}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Instagram</dt>
                <dd className="break-all">
                  {report.reportedInstagramHandle ? (
                    `@${report.reportedInstagramHandle}`
                  ) : (
                    <span className="text-muted italic">None</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">No photo, bio or Instagram when it was reported (the name only).</p>
        )}
      </div>

      {profileId ? (
        <>
          <CurrentProfile profileId={profileId} getToken={getToken} />
          <RemoveContent reportId={report.reportId} profileId={profileId} getToken={getToken} />
        </>
      ) : (
        <p className="text-xs text-muted">They no longer have a profile, so there&rsquo;s nothing left to remove.</p>
      )}
    </div>
  );
}

/** The member's profile now, with its moderation log: loaded only when opened. */
function CurrentProfile({ profileId, getToken }: { profileId: string; getToken: GetToken }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; profile: AdminMemberProfile }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    adminGetMemberProfile(profileId, getToken).then(
      (profile) => {
        if (!cancelled) setState({ status: "ready", profile });
      },
      (err: unknown) => {
        if (!cancelled) setState({ status: "error", message: errorText(err, "Couldn’t load their profile.") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, profileId, getToken, attempt]);

  return (
    <details className="group text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block motion-safe:transition-transform group-open:rotate-90">
          ▸
        </span>
        Their profile now
      </summary>
      {open && state.status === "loading" && <p className="text-muted">Loading…</p>}
      {open && state.status === "error" && (
        <div className="flex flex-col items-start gap-2">
          <Notice tone="danger" role="alert">
            {state.message}
          </Notice>
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {open && state.status === "ready" && (
        <div className="mt-2 flex flex-col gap-2">
          <p>
            {state.profile.displayName} · {state.profile.profileVisible ? "Visible to members" : "Hidden"}
            {state.profile.suspended && " · Suspended"} · {state.profile.hasAvatar ? "Has a photo" : "No photo"}
          </p>
          <p className="break-words whitespace-pre-wrap">
            <span className="text-muted">Bio: </span>
            {state.profile.bio ?? <span className="text-muted italic">None</span>}
          </p>
          <p className="break-all">
            <span className="text-muted">Instagram: </span>
            {state.profile.instagramHandle ? `@${state.profile.instagramHandle}` : <span className="text-muted italic">None</span>}
          </p>
          {state.profile.moderationLog.length > 0 ? (
            <ol className="flex flex-col gap-1 border-l-2 border-surface-border pl-3 text-xs">
              {state.profile.moderationLog.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <time dateTime={entry.at}>{formatDayTime(entry.at)}</time>: removed {listFields(entry.removed).toLowerCase()}
                  {" · "}
                  <span className="break-words whitespace-pre-wrap">{entry.reason}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted">Nothing removed by staff before.</p>
          )}
        </div>
      )}
    </details>
  );
}

/** Choose what to remove (photo, bio, Instagram), give a reason, Remove. */
function RemoveContent({ reportId, profileId, getToken }: { reportId: string; profileId: string; getToken: GetToken }) {
  const [fields, setFields] = useState<ProfileContentField[]>([]);
  const [reason, setReason] = useState("");
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const reasonId = `remove-content-reason-${reportId}`;
  const groupErrorId = `remove-content-fields-error-${reportId}`;

  function toggle(field: ProfileContentField, on: boolean) {
    setFields((current) => (on ? [...current, field] : current.filter((f) => f !== field)));
    setFieldsError(null);
    setDone(null);
  }

  async function remove() {
    if (busy) return;
    setError(null);
    setDone(null);
    const noFields = fields.length === 0 ? "Choose what to remove." : null;
    const invalid = validateMessage(reason, { label: "Reasons", empty: "Enter a reason." });
    setFieldsError(noFields);
    setReasonError(invalid);
    if (noFields) {
      firstRef.current?.focus();
      return;
    }
    if (invalid) {
      document.getElementById(reasonId)?.focus();
      return;
    }
    setBusy(true);
    try {
      const ordered = FIELDS.filter((f) => fields.includes(f));
      const result = await adminRemoveProfileContent(profileId, { fields: ordered, reason: reason.trim() }, getToken);
      const removed = result.removed ?? [];
      setDone(
        removed.length > 0
          ? `Removed: ${listFields(removed)}. Logged with your reason.`
          : "Nothing to remove: they’d already taken that off their profile.",
      );
      setFields([]);
      setReason("");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) {
        setReasonError(err.fieldErrors.reason);
        document.getElementById(reasonId)?.focus();
      } else {
        setError(errorText(err, "Couldn’t remove that. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
      <fieldset aria-describedby={fieldsError ? groupErrorId : undefined} className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-semibold">Remove from their profile</legend>
        <div className="flex flex-wrap gap-x-5">
          {FIELDS.map((field, index) => (
            <label key={field} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                ref={index === 0 ? firstRef : undefined}
                type="checkbox"
                checked={fields.includes(field)}
                onChange={(e) => toggle(field, e.target.checked)}
                aria-invalid={fieldsError ? true : undefined}
                className="size-5 shrink-0"
              />
              {PROFILE_FIELD_LABELS[field]}
            </label>
          ))}
        </div>
        {fieldsError && (
          <p id={groupErrorId} className="text-sm text-danger">
            {fieldsError}
          </p>
        )}
      </fieldset>
      <MessageField
        id={reasonId}
        label="Reason (admins only, logged)"
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (reasonError) setReasonError(null);
        }}
        error={reasonError}
        rows={2}
      />
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <div>
        <Button variant="danger" size="sm" className="min-h-11" busy={busy} onClick={remove}>
          {busy ? "Removing…" : "Remove"}
        </Button>
      </div>
      <div role="status">{done && <Notice>{done}</Notice>}</div>
    </div>
  );
}
