"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { adminCreateInvite } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminCreateInviteInput, AdminInviteRecord, InviteKind } from "@/lib/api/types";
import { websiteUrlError } from "@/lib/organiser-profile";
import { EVENT_CATEGORIES, type EventCategory } from "@/lib/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUMMARY_ID = "invite-form-summary";
const inputClass = "border border-foreground bg-transparent px-3 py-2 text-foreground";

/** The form's fields, in order, by the API's fieldErrors keys (organiser fields are `organiser.<field>`). */
const FIELDS = [
  "kind",
  "email",
  "emailConfirm",
  "organiser.displayName",
  "organiser.contactEmail",
  "organiser.description",
  "organiser.categories",
  "organiser.websiteUrl",
  "consent",
] as const;
type FormField = (typeof FIELDS)[number];

const LABELS: Record<FormField, string> = {
  kind: "Invite as",
  email: "Their email",
  emailConfirm: "Their email again",
  "organiser.displayName": "Organiser name",
  "organiser.contactEmail": "Contact email",
  "organiser.description": "Description",
  "organiser.categories": "Categories",
  "organiser.websiteUrl": "Website",
  consent: "They asked to be invited",
};

/** By any fieldErrors key: undefined for one the form has no field for. */
const LABEL_BY_KEY: Readonly<Record<string, string | undefined>> = LABELS;

/** The control focus goes to for a field's error (categories: the first checkbox). */
function controlId(field: FormField | string): string {
  if (field === "organiser.categories") return `invite-category-${EVENT_CATEGORIES[0].value}`;
  if (field === "kind") return "invite-kind-organiser";
  return `invite-${field.replace(".", "-")}`;
}

/** What the 503 means: nothing was saved or sent. */
export const INVITES_UNAVAILABLE =
  "Invites aren’t available yet: this site can’t create accounts from an invite until SUPABASE_ADMIN_INVITE_KEY is set (docs/supabase-setup.md). Nothing was saved or sent.";

/** What a sent (or saved but unsent) invite says. */
export function sentText(invite: AdminInviteRecord, emailSent: boolean): string {
  return emailSent
    ? `Invite sent to ${invite.email}. The link works for 14 days.`
    : `Invite saved, but the email to ${invite.email} didn’t send. Resend it from the list below.`;
}

/**
 * /admin/invites: invite someone who asked to join (POST /api/admin/invites).
 * An organiser invite carries the organiser's application fields (as a
 * platform-managed organiser's: name, contact email, which starts as the
 * invite's address, description, categories and website); the organiser
 * is approved when they accept. The admin confirms the person asked for it
 * (Spam Act 2003). On an error, a summary lists what to fix and focus goes
 * to the first field with one; each field's message describes it.
 */
export default function InviteForm({
  getToken,
  onCreated,
}: {
  getToken: GetToken;
  onCreated: (invite: AdminInviteRecord, emailSent: boolean) => void;
}) {
  const [kind, setKind] = useState<InviteKind>("organiser");
  const [email, setEmail] = useState("");
  // Typed twice: a typo would hand the invite (an approved organiser) to whoever gets that mail.
  const [emailConfirm, setEmailConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  // null: the same as the invite's address, until it's typed over.
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ title: string; message?: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const focusFirstError = useRef(false);
  const sentRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const organiser = kind === "organiser";
  const shownContactEmail = contactEmail ?? email;

  // After a failed submit, once the messages are rendered and wired to their
  // fields: focus the first field with one, or the summary when none is a field.
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = FIELDS.find((field) => errors[field] && (organiser || !field.startsWith("organiser.")));
    const target = first ? document.getElementById(controlId(first)) : summaryRef.current;
    target?.focus();
  }, [errors, formError, organiser]);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "Enter their email address.";
    else if (!EMAIL_REGEX.test(email.trim())) next.email = "Enter a valid email address.";
    if (!emailConfirm.trim()) next.emailConfirm = "Type their email again.";
    else if (email.trim() && emailConfirm.trim().toLowerCase() !== email.trim().toLowerCase()) {
      next.emailConfirm = "The two addresses don’t match. Check them both.";
    }
    if (organiser) {
      if (!displayName.trim()) next["organiser.displayName"] = "Enter an organiser name.";
      if (!shownContactEmail.trim()) next["organiser.contactEmail"] = "Enter a contact email.";
      else if (!EMAIL_REGEX.test(shownContactEmail.trim())) next["organiser.contactEmail"] = "Enter a valid email address.";
      if (!description.trim()) next["organiser.description"] = "Enter a short description.";
      if (categories.length === 0) next["organiser.categories"] = "Choose at least one category.";
      const websiteError = websiteUrlError(websiteUrl);
      if (websiteError) next["organiser.websiteUrl"] = websiteError;
    }
    if (!consent) next.consent = "Confirm they asked to be invited.";
    return next;
  }

  function reset() {
    setEmail("");
    setEmailConfirm("");
    setDisplayName("");
    setContactEmail(null);
    setDescription("");
    setCategories([]);
    setWebsiteUrl("");
    setConsent(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSent(null);
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setFormError({ title: "Fix these to send the invite:" });
      focusFirstError.current = true;
      return;
    }
    setErrors({});
    setFormError(null);

    const input: AdminCreateInviteInput = {
      kind,
      email: email.trim(),
      consent: true,
      ...(organiser
        ? {
            organiser: {
              displayName: displayName.trim(),
              contactEmail: shownContactEmail.trim(),
              description: description.trim(),
              categories,
              websiteUrl: websiteUrl.trim() || null,
            },
          }
        : {}),
    };

    setSaving(true);
    try {
      const result = await adminCreateInvite(input, getToken);
      reset();
      setSent(sentText(result.invite, result.emailSent));
      onCreated(result.invite, result.emailSent);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setFormError({ title: "Invites aren’t available yet", message: INVITES_UNAVAILABLE });
      } else if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setErrors(err.fieldErrors);
        setFormError({ title: "Fix these to send the invite:" });
      } else {
        setFormError({
          title: "The invite wasn’t sent",
          message: err instanceof Error && err.message ? err.message : "Try again.",
        });
      }
      focusFirstError.current = true;
    } finally {
      setSaving(false);
    }
  }

  /** aria-invalid and aria-describedby for a control whose error line is `${id}-error`, then any notes. */
  function errorProps(field: FormField, notes: string[] = []) {
    const error = errors[field];
    const describedBy = [error ? `${controlId(field)}-error` : null, ...notes].filter(Boolean).join(" ");
    return { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy || undefined } as const;
  }

  function errorLine(field: FormField) {
    return errors[field] ? (
      <p id={`${controlId(field)}-error`} className="text-sm text-danger">
        {errors[field]}
      </p>
    ) : null;
  }

  function textField(field: FormField, input: ReactNode, note?: ReactNode) {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={controlId(field)} className="eyebrow text-muted">
          {LABELS[field]}
        </label>
        {input}
        {note}
        {errorLine(field)}
      </div>
    );
  }

  // Every error, the ones no field shows (an unexpected key) included.
  const listed = Object.entries(errors).filter(([field]) => organiser || !field.startsWith("organiser."));

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5" aria-labelledby="invite-form-heading">
      {formError && (
        <div
          ref={summaryRef}
          id={SUMMARY_ID}
          role="alert"
          tabIndex={-1}
          className="border-l-2 border-danger py-1 pl-4 text-sm text-foreground outline-offset-2"
        >
          <p className="font-semibold">{formError.title}</p>
          {formError.message && <p className="mt-1">{formError.message}</p>}
          {listed.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {listed.map(([field, message]) => (
                <li key={field}>
                  {LABEL_BY_KEY[field] ? (
                    <a href={`#${controlId(field)}`} className="underline underline-offset-2">
                      {LABEL_BY_KEY[field]}: {message}
                    </a>
                  ) : (
                    message
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2" aria-describedby={errors.kind ? `${controlId("kind")}-error` : undefined}>
        <legend className="eyebrow text-muted">{LABELS.kind}</legend>
        <div className="flex flex-wrap gap-x-6">
          {(
            [
              ["organiser", "Organiser", "Approved as an organiser when they accept"],
              ["member", "Member", "An account only"],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input
                id={`invite-kind-${value}`}
                type="radio"
                name="invite-kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="size-5 accent-accent"
              />
              <span>
                {label}
                <span className="text-muted"> · {hint}</span>
              </span>
            </label>
          ))}
        </div>
        {errorLine("kind")}
      </fieldset>

      {textField(
        "email",
        <input
          id={controlId("email")}
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...errorProps("email", ["invite-email-note"])}
          className={inputClass}
        />,
        <p id="invite-email-note" className="text-sm text-muted">
          The invite link goes here. They accept with this address.
        </p>,
      )}

      {textField(
        "emailConfirm",
        <input
          id={controlId("emailConfirm")}
          type="email"
          autoComplete="off"
          value={emailConfirm}
          onChange={(e) => setEmailConfirm(e.target.value)}
          {...errorProps("emailConfirm", ["invite-emailConfirm-note"])}
          className={inputClass}
        />,
        <p id="invite-emailConfirm-note" className="text-sm text-muted">
          To catch a typo: whoever gets this email can accept the invite.
        </p>,
      )}

      {organiser && (
        <fieldset className="flex flex-col gap-5 border-t border-surface-border pt-4">
          <legend className="font-heading text-lg text-foreground">The organiser</legend>
          <p className="-mt-2 text-sm text-muted">
            As on an organiser application. Its profile is public once they accept.
          </p>
          {textField(
            "organiser.displayName",
            <input
              id={controlId("organiser.displayName")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              {...errorProps("organiser.displayName")}
              className={inputClass}
            />,
          )}
          {textField(
            "organiser.contactEmail",
            <input
              id={controlId("organiser.contactEmail")}
              type="email"
              autoComplete="off"
              value={shownContactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              {...errorProps("organiser.contactEmail", ["invite-organiser-contactEmail-note"])}
              className={inputClass}
            />,
            <p id="invite-organiser-contactEmail-note" className="text-sm text-muted">
              Starts as their email. Where buyers and Sheltüh reach the organiser.
            </p>,
          )}
          {textField(
            "organiser.description",
            <textarea
              id={controlId("organiser.description")}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              {...errorProps("organiser.description")}
              className={inputClass}
            />,
          )}
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={errors["organiser.categories"] ? `${controlId("organiser.categories")}-error` : undefined}
          >
            <legend className="eyebrow text-muted">{LABELS["organiser.categories"]}</legend>
            <div className="flex flex-wrap gap-x-4">
              {EVENT_CATEGORIES.map((c) => (
                <label key={c.value} className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input
                    id={`invite-category-${c.value}`}
                    type="checkbox"
                    checked={categories.includes(c.value)}
                    onChange={(e) =>
                      setCategories((prev) => (e.target.checked ? [...prev, c.value] : prev.filter((v) => v !== c.value)))
                    }
                    aria-invalid={errors["organiser.categories"] ? true : undefined}
                    className="size-5 accent-accent"
                  />
                  {c.label}
                </label>
              ))}
            </div>
            {errorLine("organiser.categories")}
          </fieldset>
          {textField(
            "organiser.websiteUrl",
            <input
              id={controlId("organiser.websiteUrl")}
              type="url"
              placeholder="https://"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              {...errorProps("organiser.websiteUrl", ["invite-organiser-websiteUrl-note"])}
              className={inputClass}
            />,
            <p id="invite-organiser-websiteUrl-note" className="text-sm text-muted">
              Optional.
            </p>,
          )}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm text-foreground">
          <input
            id={controlId("consent")}
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
            {...errorProps("consent", ["invite-consent-note"])}
            className="mt-0.5 size-5 shrink-0 accent-accent"
          />
          <span>They asked to be invited (required)</span>
        </label>
        <p id="invite-consent-note" className="text-sm text-muted">
          We only email people who asked for an invite (Spam Act 2003). There are no reminders: one email now, and
          another only if you resend it.
        </p>
        {errorLine("consent")}
      </div>

      <div>
        <Button
          type="submit"
          variant="solid"
          busy={saving}
          aria-describedby={formError ? SUMMARY_ID : undefined}
          className="min-h-11 w-full sm:w-auto"
        >
          {saving ? "Sending…" : "Send invite"}
        </Button>
      </div>

      {sent && (
        <div ref={sentRef} tabIndex={-1} className="outline-offset-2">
          <Notice role="status">{sent}</Notice>
        </div>
      )}
    </form>
  );
}
