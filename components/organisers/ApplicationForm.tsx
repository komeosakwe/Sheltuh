"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import InlineReauth from "@/components/auth/InlineReauth";
import SocialHandleFields from "@/components/organisers/SocialHandleFields";
import { ApiError, type GetToken } from "@/lib/api/client";
import { applyAsOrganiser, resubmitOrganiser, type OrganiserApplicationInput } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import {
  SOCIAL_HANDLE_FIELDS,
  socialHandlesForRequest,
  websiteUrlError,
  type SocialHandleField,
  type SocialHandleValues,
} from "@/lib/organiser-profile";
import { EVENT_CATEGORIES } from "@/lib/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PREFIX = "application";
const FIX_FIELDS_MESSAGE = "Please fix the highlighted fields.";

type ApplicationField = "displayName" | "contactEmail" | "description" | "categories" | "websiteUrl" | SocialHandleField;
/** Form order, for moving focus to the first field with an error. */
const FIELD_ORDER: readonly ApplicationField[] = [
  "displayName",
  "contactEmail",
  "description",
  "categories",
  "websiteUrl",
  ...SOCIAL_HANDLE_FIELDS.map((f) => f.field),
];

/** The id of the control focus moves to for a field's error (categories: the first checkbox). */
function focusTargetId(field: ApplicationField): string {
  if (field === "categories") return categoryId(EVENT_CATEGORIES[0].value);
  if (SOCIAL_HANDLE_FIELDS.some((f) => f.field === field)) return `${ID_PREFIX}-${field}`;
  return field;
}

function categoryId(value: string): string {
  return `${ID_PREFIX}-category-${value}`;
}

/**
 * aria-invalid / aria-describedby for a control with a possible error line
 * `${id}-error`, read before any always-present `notes` (other element ids).
 */
function errorProps(id: string, error: string | undefined, notes: readonly string[] = []) {
  const describedBy = [error ? `${id}-error` : null, ...notes].filter(Boolean).join(" ");
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

/** Said under the fields that appear on the public profile (the social group says it too). */
const PUBLIC_NOTE = "Shown publicly on your organiser profile once approved.";

interface Props {
  mode: "apply" | "resubmit";
  getToken: GetToken;
  initial?: OrganiserRecord;
  onSuccess: (record: OrganiserRecord) => void;
}

export default function ApplicationForm({ mode, getToken, initial, onSuccess }: Props) {
  const auth = useAuth();
  // Captured once at mount: the account filling out this application, so a
  // session-expiry recovery only ever resumes as this same account —
  // otherwise a signed-in-as-someone-else recovery would submit this
  // organiser application under the wrong account entirely.
  const [ownerEmail] = useState(() => auth.email);
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categories, setCategories] = useState<string[]>(initial?.categories ?? []);
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? "");
  const [handles, setHandles] = useState<SocialHandleValues>({
    instagramHandle: initial?.instagramHandle ?? "",
    tiktokHandle: initial?.tiktokHandle ?? "",
    facebookPage: initial?.facebookPage ?? "",
    xHandle: initial?.xHandle ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const focusFirstError = useRef(false);

  // After a failed submit (client checks or the server's field errors), once
  // the messages are rendered and wired to their fields, move focus to the
  // first field that has one.
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) document.getElementById(focusTargetId(first))?.focus();
  }, [errors]);

  function toggleCategory(value: string) {
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  function setHandle(field: SocialHandleField, value: string) {
    setHandles((prev) => ({ ...prev, [field]: value }));
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!displayName.trim()) next.displayName = "Enter an organiser name.";
    if (!contactEmail.trim()) next.contactEmail = "Enter a contact email.";
    else if (!EMAIL_REGEX.test(contactEmail.trim())) next.contactEmail = "Enter a valid email address.";
    if (!description.trim()) next.description = "Enter a short description.";
    if (categories.length === 0) next.categories = "Choose at least one category.";
    // On a resubmit, the website already on the application, left as it is,
    // is fine even from before the https rule (as the API allows).
    const websiteError = websiteUrlError(websiteUrl, initial?.websiteUrl);
    if (websiteError) next.websiteUrl = websiteError;
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSessionExpired(false);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError.current = true;
      setSubmitError(FIX_FIELDS_MESSAGE);
      return;
    }

    const input: OrganiserApplicationInput = {
      displayName: displayName.trim(),
      contactEmail: contactEmail.trim(),
      description: description.trim(),
      categories: categories as OrganiserApplicationInput["categories"],
      websiteUrl: websiteUrl.trim() || undefined,
      // Blank is sent as null: on a resubmit that clears a handle (one left
      // out would be kept). The server validates them and drops any '@'.
      ...socialHandlesForRequest(handles),
    };

    setLoading(true);
    try {
      const record =
        mode === "apply" ? await applyAsOrganiser(input, getToken) : await resubmitOrganiser(input, getToken);
      onSuccess(record);
    } catch (err) {
      // None of the fields above are cleared here — a failed submission
      // (including an expired session) leaves everything you typed in place.
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true);
        setSubmitError(err.message);
        return;
      }
      if (err instanceof ApiError && err.fieldErrors) {
        focusFirstError.current = true;
        setErrors(err.fieldErrors);
      }
      setSubmitError(err instanceof Error ? err.message : "Couldn't submit your application.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="displayName" className="text-sm font-medium text-foreground">
          Organiser name
        </label>
        <input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          {...errorProps("displayName", errors.displayName)}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
        {errors.displayName && (
          <p id="displayName-error" className="text-sm text-danger">
            {errors.displayName}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="contactEmail" className="text-sm font-medium text-foreground">
          Contact email
        </label>
        <input
          id="contactEmail"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          {...errorProps("contactEmail", errors.contactEmail)}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
        {errors.contactEmail && (
          <p id="contactEmail-error" className="text-sm text-danger">
            {errors.contactEmail}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-foreground">
          Short description
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          {...errorProps("description", errors.description, ["description-note"])}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
        <p id="description-note" className="text-sm text-muted">
          {PUBLIC_NOTE}
        </p>
        {errors.description && (
          <p id="description-error" className="text-sm text-danger">
            {errors.description}
          </p>
        )}
      </div>

      {/* The error describes the whole group (announced as focus enters it);
          each checkbox carries aria-invalid, which a fieldset can't. */}
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.categories ? `${ID_PREFIX}-categories-error` : undefined}
      >
        <legend className="text-sm font-medium text-foreground">Event categories</legend>
        <div className="flex flex-wrap gap-3">
          {EVENT_CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                id={categoryId(c.value)}
                type="checkbox"
                checked={categories.includes(c.value)}
                onChange={() => toggleCategory(c.value)}
                aria-invalid={errors.categories ? true : undefined}
                className="accent-accent"
              />
              {c.label}
            </label>
          ))}
        </div>
        {errors.categories && (
          <p id={`${ID_PREFIX}-categories-error`} className="text-sm text-danger">
            {errors.categories}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="websiteUrl" className="text-sm font-medium text-foreground">
          Website (optional)
        </label>
        <input
          id="websiteUrl"
          type="url"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://"
          {...errorProps("websiteUrl", errors.websiteUrl, ["websiteUrl-note"])}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
        <p id="websiteUrl-note" className="text-sm text-muted">
          {PUBLIC_NOTE}
        </p>
        {errors.websiteUrl && (
          <p id="websiteUrl-error" className="text-sm text-danger">
            {errors.websiteUrl}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-4" aria-describedby="application-social-note">
        <legend className="text-sm font-medium text-foreground">Optional: social profiles</legend>
        <p id="application-social-note" className="text-sm text-muted">
          {PUBLIC_NOTE}
        </p>
        <SocialHandleFields
          idPrefix={ID_PREFIX}
          values={handles}
          errors={errors}
          onChange={setHandle}
          inputClassName="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
      </fieldset>

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

      <button
        type="submit"
        disabled={loading}
        className="btn btn-solid w-fit"
      >
        {loading ? "Submitting…" : mode === "apply" ? "Submit application" : "Resubmit application"}
      </button>
    </form>
  );
}
