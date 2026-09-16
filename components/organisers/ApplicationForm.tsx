"use client";

import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api/client";
import { applyAsOrganiser, resubmitOrganiser, type OrganiserApplicationInput } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { EVENT_CATEGORIES } from "@/lib/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  mode: "apply" | "resubmit";
  idToken: string;
  initial?: OrganiserRecord;
  onSuccess: (record: OrganiserRecord) => void;
}

export default function ApplicationForm({ mode, idToken, initial, onSuccess }: Props) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categories, setCategories] = useState<string[]>(initial?.categories ?? []);
  const [websiteUrl, setWebsiteUrl] = useState(initial?.websiteUrl ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggleCategory(value: string) {
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!displayName.trim()) next.displayName = "Enter an organiser name.";
    if (!contactEmail.trim()) next.contactEmail = "Enter a contact email.";
    else if (!EMAIL_REGEX.test(contactEmail.trim())) next.contactEmail = "Enter a valid email address.";
    if (!description.trim()) next.description = "Enter a short description.";
    if (categories.length === 0) next.categories = "Choose at least one category.";
    if (websiteUrl.trim()) {
      try {
        new URL(websiteUrl.trim());
      } catch {
        next.websiteUrl = "Enter a valid URL, including https://";
      }
    }
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input: OrganiserApplicationInput = {
      displayName: displayName.trim(),
      contactEmail: contactEmail.trim(),
      description: description.trim(),
      categories: categories as OrganiserApplicationInput["categories"],
      websiteUrl: websiteUrl.trim() || undefined,
    };

    setLoading(true);
    try {
      const record =
        mode === "apply" ? await applyAsOrganiser(input, idToken) : await resubmitOrganiser(input, idToken);
      onSuccess(record);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors);
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
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.displayName && <p className="text-sm text-danger">{errors.displayName}</p>}
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
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.contactEmail && <p className="text-sm text-danger">{errors.contactEmail}</p>}
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
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.description && <p className="text-sm text-danger">{errors.description}</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Event categories</legend>
        <div className="flex flex-wrap gap-3">
          {EVENT_CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={categories.includes(c.value)}
                onChange={() => toggleCategory(c.value)}
                className="accent-accent"
              />
              {c.label}
            </label>
          ))}
        </div>
        {errors.categories && <p className="text-sm text-danger">{errors.categories}</p>}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="websiteUrl" className="text-sm font-medium text-foreground">
          Website or social link (optional)
        </label>
        <input
          id="websiteUrl"
          type="url"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://"
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.websiteUrl && <p className="text-sm text-danger">{errors.websiteUrl}</p>}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Submitting…" : mode === "apply" ? "Submit application" : "Resubmit application"}
      </button>
    </form>
  );
}
