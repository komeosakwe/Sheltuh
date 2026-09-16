"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { EVENT_CATEGORIES } from "@/lib/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  organiserName: string;
  contactEmail: string;
  eventTitle: string;
  description: string;
  category: string;
  venue: string;
  suburb: string;
  date: string;
  time: string;
  pricing: "free" | "paid" | "";
}

const initialState: FormState = {
  organiserName: "",
  contactEmail: "",
  eventTitle: "",
  description: "",
  category: "",
  venue: "",
  suburb: "",
  date: "",
  time: "",
  pricing: "",
};

type FormErrors = Partial<Record<keyof FormState, string>>;

function validate(values: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!values.organiserName.trim()) errors.organiserName = "Enter the organiser's name.";
  if (!values.contactEmail.trim()) {
    errors.contactEmail = "Enter a contact email.";
  } else if (!EMAIL_REGEX.test(values.contactEmail.trim())) {
    errors.contactEmail = "Enter a valid email address, e.g. name@example.com.";
  }
  if (!values.eventTitle.trim()) errors.eventTitle = "Enter an event title.";
  if (!values.description.trim()) errors.description = "Enter a short description.";
  if (!values.category) errors.category = "Choose a category.";
  if (!values.venue.trim()) errors.venue = "Enter a venue name.";
  if (!values.suburb.trim()) errors.suburb = "Enter a suburb.";

  if (!values.date) {
    errors.date = "Enter a date.";
  } else {
    const chosen = new Date(`${values.date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(chosen.getTime())) {
      errors.date = "Enter a valid date.";
    } else if (chosen < today) {
      errors.date = "Choose a date that hasn't already passed.";
    }
  }

  if (!values.time) errors.time = "Enter a start time.";
  if (!values.pricing) errors.pricing = "Choose free or paid.";

  return errors;
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "rounded border border-surface-border bg-background px-3 py-2 text-foreground";

export default function SubmitEventForm() {
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submittedSuccessfully, setSubmittedSuccessfully] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmittedSuccessfully(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    setSubmittedSuccessfully(Object.keys(nextErrors).length === 0);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field id="organiserName" label="Organiser name" error={errors.organiserName}>
        <input
          id="organiserName"
          type="text"
          value={form.organiserName}
          onChange={(e) => update("organiserName", e.target.value)}
          aria-invalid={Boolean(errors.organiserName)}
          aria-describedby={errors.organiserName ? "organiserName-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="contactEmail" label="Contact email" error={errors.contactEmail}>
        <input
          id="contactEmail"
          type="email"
          value={form.contactEmail}
          onChange={(e) => update("contactEmail", e.target.value)}
          aria-invalid={Boolean(errors.contactEmail)}
          aria-describedby={errors.contactEmail ? "contactEmail-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="eventTitle" label="Event title" error={errors.eventTitle}>
        <input
          id="eventTitle"
          type="text"
          value={form.eventTitle}
          onChange={(e) => update("eventTitle", e.target.value)}
          aria-invalid={Boolean(errors.eventTitle)}
          aria-describedby={errors.eventTitle ? "eventTitle-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="description" label="Description" error={errors.description}>
        <textarea
          id="description"
          rows={4}
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? "description-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="category" label="Category" error={errors.category}>
        <select
          id="category"
          value={form.category}
          onChange={(e) => update("category", e.target.value)}
          aria-invalid={Boolean(errors.category)}
          aria-describedby={errors.category ? "category-error" : undefined}
          className={inputClass}
        >
          <option value="">Choose a category&hellip;</option>
          {EVENT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="venue" label="Venue name" error={errors.venue}>
        <input
          id="venue"
          type="text"
          value={form.venue}
          onChange={(e) => update("venue", e.target.value)}
          aria-invalid={Boolean(errors.venue)}
          aria-describedby={errors.venue ? "venue-error" : undefined}
          className={inputClass}
        />
      </Field>

      <Field id="suburb" label="Suburb" error={errors.suburb}>
        <input
          id="suburb"
          type="text"
          value={form.suburb}
          onChange={(e) => update("suburb", e.target.value)}
          aria-invalid={Boolean(errors.suburb)}
          aria-describedby={errors.suburb ? "suburb-error" : undefined}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field id="date" label="Date" error={errors.date}>
          <input
            id="date"
            type="date"
            value={form.date}
            onChange={(e) => update("date", e.target.value)}
            aria-invalid={Boolean(errors.date)}
            aria-describedby={errors.date ? "date-error" : undefined}
            className={inputClass}
          />
        </Field>

        <Field id="time" label="Start time" error={errors.time}>
          <input
            id="time"
            type="time"
            value={form.time}
            onChange={(e) => update("time", e.target.value)}
            aria-invalid={Boolean(errors.time)}
            aria-describedby={errors.time ? "time-error" : undefined}
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-foreground">Free or paid?</legend>
        <div className="flex gap-4 pt-1">
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="radio"
              name="pricing"
              value="free"
              checked={form.pricing === "free"}
              onChange={() => update("pricing", "free")}
              className="accent-accent"
            />
            Free
          </label>
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="radio"
              name="pricing"
              value="paid"
              checked={form.pricing === "paid"}
              onChange={() => update("pricing", "paid")}
              className="accent-accent"
            />
            Paid
          </label>
        </div>
        {errors.pricing && (
          <p role="alert" className="text-sm text-danger">
            {errors.pricing}
          </p>
        )}
      </fieldset>

      {submittedSuccessfully && (
        <div
          role="status"
          className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3 font-medium text-foreground"
        >
          Demo validation successful — nothing has been submitted.
        </div>
      )}

      <button
        type="submit"
        className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
      >
        Validate submission
      </button>
    </form>
  );
}
