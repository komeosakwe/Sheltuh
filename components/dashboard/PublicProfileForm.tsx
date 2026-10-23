"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import InlineReauth from "@/components/auth/InlineReauth";
import FeaturedVideoField, {
  featuredVideoChanged,
  featuredVideoInitial,
  featuredVideoUrlError,
} from "@/components/organisers/FeaturedVideoField";
import SocialHandleFields from "@/components/organisers/SocialHandleFields";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { ApiError, type GetToken } from "@/lib/api/client";
import { updateOrganiserProfile, type OrganiserProfileInput } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import {
  MAX_BIO_LENGTH,
  SOCIAL_HANDLE_FIELDS,
  socialHandlesForRequest,
  websiteUrlError,
  type SocialHandleField,
  type SocialHandleValues,
} from "@/lib/organiser-profile";

const ID_PREFIX = "profile";
type ProfileField = "description" | "websiteUrl" | SocialHandleField | "featuredVideoUrl";
/** Form order, for moving focus to the first field with an error. */
const FIELD_ORDER: readonly ProfileField[] = [
  "description",
  "websiteUrl",
  ...SOCIAL_HANDLE_FIELDS.map((f) => f.field),
  "featuredVideoUrl",
];

function fieldId(field: ProfileField) {
  return `${ID_PREFIX}-${field}`;
}

function handlesOf(record: OrganiserRecord): SocialHandleValues {
  return {
    instagramHandle: record.instagramHandle ?? "",
    tiktokHandle: record.tiktokHandle ?? "",
    facebookPage: record.facebookPage ?? "",
    xHandle: record.xHandle ?? "",
  };
}

const countFormatter = new Intl.NumberFormat("en-AU");
/** How long the status line stays empty before a repeated message, so it's announced again. */
const REANNOUNCE_DELAY_MS = 100;

/** "1 character", "1,995 characters". */
function characters(count: number) {
  return `${countFormatter.format(count)} ${count === 1 ? "character" : "characters"}`;
}

interface Props {
  organiser: OrganiserRecord;
  getToken: GetToken;
  /** Called with the saved record after a successful save. */
  onSaved?: (record: OrganiserRecord) => void;
}

/**
 * An approved organiser's public profile: bio, website, social handles and a
 * featured video. Saved straight away (no new review). Only the fields that
 * changed are sent; a blank website, handle or video clears it.
 */
export default function PublicProfileForm({ organiser, getToken, onSaved }: Props) {
  const auth = useAuth();
  // As in the application form: an expired-session recovery may only resume
  // as the account that was editing.
  const [ownerEmail] = useState(() => auth.email);
  const [saved, setSaved] = useState(organiser);
  const [description, setDescription] = useState(organiser.description);
  const [websiteUrl, setWebsiteUrl] = useState(organiser.websiteUrl ?? "");
  const [handles, setHandles] = useState<SocialHandleValues>(() => handlesOf(organiser));
  const [video, setVideo] = useState(() => featuredVideoInitial(organiser.featuredVideo));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const focusFirstError = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const timer = statusTimer;
    return () => clearTimeout(timer.current);
  }, []);

  // After a failed save, once the error messages are rendered (and wired to
  // their fields), move focus to the first field that has one.
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }, [errors]);

  /** Sets the status line, cancelling any message still waiting to be shown. */
  function showStatus(message: string | null) {
    clearTimeout(statusTimer.current);
    setStatus(message);
  }

  /**
   * Empties the status line, then fills it a moment later: a live region only
   * speaks when its text changes, so "No changes to save." twice in a row
   * would otherwise be heard once.
   */
  function announce(message: string) {
    showStatus(null);
    statusTimer.current = setTimeout(() => setStatus(message), REANNOUNCE_DELAY_MS);
  }

  function edited() {
    showStatus(null);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!description.trim()) next.description = "Enter a bio.";
    else if (description.length > MAX_BIO_LENGTH) {
      next.description = `Your bio must be ${countFormatter.format(MAX_BIO_LENGTH)} characters or fewer.`;
    }
    // The saved website, left as it is, is fine even from before the https rule.
    const websiteError = websiteUrlError(websiteUrl, saved.websiteUrl);
    if (websiteError) next.websiteUrl = websiteError;
    const videoError = featuredVideoUrlError(video);
    if (videoError) next.featuredVideoUrl = videoError;
    return next;
  }

  /** Only what differs from the last saved profile. */
  function changes(): OrganiserProfileInput {
    const input: OrganiserProfileInput = {};
    const nextDescription = description.trim();
    if (nextDescription !== saved.description) input.description = nextDescription;
    const nextWebsite = websiteUrl.trim() || null;
    if (nextWebsite !== (saved.websiteUrl ?? null)) input.websiteUrl = nextWebsite;
    const nextHandles = socialHandlesForRequest(handles);
    for (const { field } of SOCIAL_HANDLE_FIELDS) {
      if (nextHandles[field] !== (saved[field] ?? null)) input[field] = nextHandles[field];
    }
    if (featuredVideoChanged(video, saved.featuredVideo)) input.featuredVideoUrl = video.trim() || null;
    return input;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showStatus(null);
    setSubmitError(null);
    setSessionExpired(false);

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError.current = true;
      setSubmitError("Please fix the highlighted fields.");
      return;
    }

    const input = changes();
    if (Object.keys(input).length === 0) {
      announce("No changes to save.");
      return;
    }

    setSaving(true);
    try {
      const record = await updateOrganiserProfile(input, getToken);
      setSaved(record);
      // Show what was stored (e.g. a handle typed with '@' comes back without it).
      setDescription(record.description);
      setWebsiteUrl(record.websiteUrl ?? "");
      setHandles(handlesOf(record));
      setVideo(featuredVideoInitial(record.featuredVideo));
      showStatus("Profile saved. It's live on your public profile now.");
      onSaved?.(record);
    } catch (err) {
      // Nothing typed is cleared on a failure.
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true);
        setSubmitError(err.message);
        return;
      }
      if (err instanceof ApiError && err.fieldErrors) {
        focusFirstError.current = true;
        setErrors(err.fieldErrors);
      }
      setSubmitError(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  const remaining = MAX_BIO_LENGTH - description.length;
  const descriptionError = errors.description;
  const websiteError = errors.websiteUrl;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("description")} className="text-sm font-medium text-foreground">
          Bio <span className="font-normal text-muted">(required)</span>
        </label>
        <textarea
          id={fieldId("description")}
          rows={6}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            edited();
          }}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={[`${fieldId("description")}-count`, descriptionError && `${fieldId("description")}-error`]
            .filter(Boolean)
            .join(" ")}
          className={fieldClass}
        />
        <p
          id={`${fieldId("description")}-count`}
          className={`text-xs tabular-nums ${remaining < 0 ? "text-danger" : "text-muted"}`}
        >
          {remaining >= 0
            ? `${characters(remaining)} left`
            : `${characters(-remaining)} too many`}
        </p>
        {descriptionError && (
          <p id={`${fieldId("description")}-error`} className="text-sm text-danger">
            {descriptionError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("websiteUrl")} className="text-sm font-medium text-foreground">
          Website (optional)
        </label>
        <input
          id={fieldId("websiteUrl")}
          type="url"
          inputMode="url"
          autoComplete="url"
          value={websiteUrl}
          onChange={(e) => {
            setWebsiteUrl(e.target.value);
            edited();
          }}
          placeholder="https://"
          aria-invalid={websiteError ? true : undefined}
          aria-describedby={websiteError ? `${fieldId("websiteUrl")}-error` : undefined}
          className={fieldClass}
        />
        {websiteError && (
          <p id={`${fieldId("websiteUrl")}-error`} className="text-sm text-danger">
            {websiteError}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-4" aria-describedby={`${ID_PREFIX}-social-note`}>
        <legend className="text-sm font-medium text-foreground">Social profiles (optional)</legend>
        <p id={`${ID_PREFIX}-social-note`} className="text-sm text-muted">
          Shown as links on your public profile. Leave one blank to remove it.
        </p>
        <SocialHandleFields
          idPrefix={ID_PREFIX}
          values={handles}
          errors={errors}
          onChange={(field, value) => {
            setHandles((prev) => ({ ...prev, [field]: value }));
            edited();
          }}
          inputClassName={fieldClass}
        />
      </fieldset>

      <FeaturedVideoField
        id={fieldId("featuredVideoUrl")}
        value={video}
        onChange={(value) => {
          setVideo(value);
          edited();
        }}
        error={errors.featuredVideoUrl}
        labelClassName="text-sm font-medium text-foreground"
        inputClassName={fieldClass}
      />

      {submitError && sessionExpired && (
        <div role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          <p>{submitError}</p>
          <InlineReauth
            expectedEmail={ownerEmail}
            onSignedIn={() => {
              setSessionExpired(false);
              setSubmitError(null);
            }}
          />
        </div>
      )}
      {submitError && !sessionExpired && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      {/* Always rendered (and never display:none, which would take it out of the
          accessibility tree), so the result of a save is announced when it
          changes. Empty, it's collapsed to nothing visually. */}
      <p role="status" className="text-sm text-foreground empty:sr-only">
        {status}
      </p>

      <Button type="submit" size="lg" busy={saving} className="w-fit">
        {saving ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
