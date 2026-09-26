"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import InlineReauth from "@/components/auth/InlineReauth";
import { ApiError, type GetToken } from "@/lib/api/client";
import { createEventDraft, submitEventForReview, updateEventDraft, type EventInput } from "@/lib/api/events";
import type { EventRecord, TicketTypeInput } from "@/lib/api/types";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { calculateOrderSummary, MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { formatAud, toMelbourneDateTimeInputParts } from "@/lib/format";
import { EVENT_CATEGORIES } from "@/lib/types";

interface Props {
  getToken: GetToken;
  initial?: EventRecord;
  onSaved: (record: EventRecord) => void;
}

function newTicketType(): TicketTypeInput {
  return {
    id: crypto.randomUUID(),
    name: "",
    priceCents: 0,
    feePolicy: "buyer-pays",
    quantityAvailable: 20,
  };
}

export default function EventEditor({ getToken, initial, onSaved }: Props) {
  const router = useRouter();
  const auth = useAuth();
  // Captured once at mount: the account this draft belongs to, so that if
  // the session expires mid-edit, recovery only accepts signing back in as
  // this same account — never a different one saving over it.
  const [ownerEmail] = useState(() => auth.email);
  const locked = initial ? initial.status === "pending_review" || initial.status === "published" : false;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? EVENT_CATEGORIES[0].value);
  const [venueName, setVenueName] = useState(initial?.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(initial?.venueAddress ?? "");
  const [suburb, setSuburb] = useState(initial?.suburb ?? "");
  const [start, setStart] = useState(initial ? toMelbourneDateTimeInputParts(initial.startsAt) : { date: "", time: "" });
  const [end, setEnd] = useState(initial ? toMelbourneDateTimeInputParts(initial.endsAt) : { date: "", time: "" });
  const [ticketTypes, setTicketTypes] = useState<TicketTypeInput[]>(
    initial?.ticketTypes && initial.ticketTypes.length > 0 ? initial.ticketTypes : [newTicketType()],
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleError(err: unknown, fallback: string) {
    if (err instanceof SessionExpiredError) {
      setSessionExpired(true);
      setSubmitError(err.message);
      return;
    }
    if (err instanceof ApiError && err.fieldErrors) setErrors((prev) => ({ ...prev, ...err.fieldErrors }));
    setSubmitError(err instanceof Error ? err.message : fallback);
  }

  function updateTicket(index: number, patch: Partial<TicketTypeInput>) {
    setTicketTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTicket(index: number) {
    setTicketTypes((prev) => prev.filter((_, i) => i !== index));
  }

  function buildInput(): EventInput | null {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = "Enter an event title.";
    if (!description.trim()) nextErrors.description = "Enter a description.";
    if (!venueName.trim()) nextErrors.venueName = "Enter a venue name.";
    if (!venueAddress.trim()) nextErrors.venueAddress = "Enter a venue address.";
    if (!suburb.trim()) nextErrors.suburb = "Enter a suburb.";
    if (!start.date || !start.time) nextErrors.start = "Enter a start date and time.";
    if (!end.date || !end.time) nextErrors.end = "Enter an end date and time.";
    if (ticketTypes.length === 0) nextErrors.ticketTypes = "Add at least one ticket type.";
    ticketTypes.forEach((t, i) => {
      if (!t.name.trim()) nextErrors[`ticket-${i}-name`] = "Enter a ticket name.";
      if (!Number.isInteger(t.priceCents) || t.priceCents < 0) nextErrors[`ticket-${i}-price`] = "Enter a valid price.";
      else if (t.priceCents > 0 && t.priceCents < MIN_PAID_TICKET_CENTS)
        nextErrors[`ticket-${i}-price`] = `A paid ticket must cost at least ${formatAud(MIN_PAID_TICKET_CENTS)} (or make it free).`;
      if (!Number.isInteger(t.quantityAvailable) || t.quantityAvailable < 1)
        nextErrors[`ticket-${i}-qty`] = "Enter how many are available.";
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return null;

    return {
      title: title.trim(),
      description: description.trim(),
      category,
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      suburb: suburb.trim(),
      start,
      end,
      ticketTypes,
    };
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setSessionExpired(false);
    const input = buildInput();
    if (!input) return;

    setSaving(true);
    try {
      const record = initial
        ? await updateEventDraft(initial.eventId, input, getToken)
        : await createEventDraft(input, getToken);
      if (!initial) {
        router.push(`/dashboard/${record.eventId}`);
        return;
      }
      onSaved(record);
    } catch (err) {
      // Never clears title/description/tickets/etc. above — a failed save
      // (including an expired session) leaves the form exactly as typed.
      handleError(err, "Couldn't save this event.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForReview() {
    if (!initial) return;
    setSubmitError(null);
    setSessionExpired(false);
    // Submit what's on screen, not the last save: unsaved edits are saved
    // first, and nothing is submitted if they don't validate.
    const input = buildInput();
    if (!input) return;
    setSubmitting(true);
    try {
      await updateEventDraft(initial.eventId, input, getToken);
      const record = await submitEventForReview(initial.eventId, getToken);
      onSaved(record);
    } catch (err) {
      handleError(err, "Couldn't submit this event for review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4 text-foreground">
        <p className="font-heading text-xl">
          {initial?.status === "published" ? "Published" : "Pending review"}
        </p>
        <p className="mt-2 text-sm text-muted">
          This event can&rsquo;t be edited while it&rsquo;s{" "}
          {initial?.status === "published" ? "published" : "pending review"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6" noValidate>
      {initial?.status === "rejected" && initial.rejectionReason && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Not approved — reviewer note:</p>
          <p className="mt-1 text-muted">{initial.rejectionReason}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium text-foreground">
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.title && <p className="text-sm text-danger">{errors.title}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-foreground">
          Description
        </label>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
        {errors.description && <p className="text-sm text-danger">{errors.description}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="text-sm font-medium text-foreground">
          Category
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        >
          {EVENT_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="venueName" className="text-sm font-medium text-foreground">
            Venue name
          </label>
          <input
            id="venueName"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
          />
          {errors.venueName && <p className="text-sm text-danger">{errors.venueName}</p>}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="venueAddress" className="text-sm font-medium text-foreground">
            Venue address
          </label>
          <input
            id="venueAddress"
            value={venueAddress}
            onChange={(e) => setVenueAddress(e.target.value)}
            className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
          />
          {errors.venueAddress && <p className="text-sm text-danger">{errors.venueAddress}</p>}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="suburb" className="text-sm font-medium text-foreground">
            Suburb
          </label>
          <input
            id="suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
          />
          {errors.suburb && <p className="text-sm text-danger">{errors.suburb}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Starts (Melbourne time)</legend>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={start.date}
              onChange={(e) => setStart((s) => ({ ...s, date: e.target.value }))}
              className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
            />
            <input
              type="time"
              aria-label="Start time"
              value={start.time}
              onChange={(e) => setStart((s) => ({ ...s, time: e.target.value }))}
              className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
            />
          </div>
          {(errors.start || errors.end) && <p className="text-sm text-danger">{errors.start || errors.end}</p>}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Ends (Melbourne time)</legend>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="End date"
              value={end.date}
              onChange={(e) => setEnd((s) => ({ ...s, date: e.target.value }))}
              className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
            />
            <input
              type="time"
              aria-label="End time"
              value={end.time}
              onChange={(e) => setEnd((s) => ({ ...s, time: e.target.value }))}
              className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
            />
          </div>
        </fieldset>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl text-foreground">Ticket types</h2>
          <button
            type="button"
            onClick={() => setTicketTypes((prev) => [...prev, newTicketType()])}
            className="rounded border border-surface-border px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Add ticket type
          </button>
        </div>
        {errors.ticketTypes && <p className="text-sm text-danger">{errors.ticketTypes}</p>}

        {ticketTypes.map((ticket, index) => {
          const summary = calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy);
          return (
            <div key={ticket.id} className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-name`} className="text-sm font-medium text-foreground">
                    Name
                  </label>
                  <input
                    id={`ticket-${index}-name`}
                    value={ticket.name}
                    onChange={(e) => updateTicket(index, { name: e.target.value })}
                    className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                  />
                  {errors[`ticket-${index}-name`] && (
                    <p className="text-sm text-danger">{errors[`ticket-${index}-name`]}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-price`} className="text-sm font-medium text-foreground">
                    Price (A$)
                  </label>
                  <input
                    id={`ticket-${index}-price`}
                    type="number"
                    min={0}
                    step={0.5}
                    value={ticket.priceCents / 100}
                    onChange={(e) =>
                      updateTicket(index, { priceCents: Math.round(Number(e.target.value) * 100) || 0 })
                    }
                    className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                  />
                  {errors[`ticket-${index}-price`] && (
                    <p className="text-sm text-danger">{errors[`ticket-${index}-price`]}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-fee-policy`} className="text-sm font-medium text-foreground">
                    Who pays the booking fee?
                  </label>
                  <select
                    id={`ticket-${index}-fee-policy`}
                    value={ticket.feePolicy}
                    onChange={(e) => updateTicket(index, { feePolicy: e.target.value as TicketTypeInput["feePolicy"] })}
                    className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                  >
                    <option value="buyer-pays">Buyer pays</option>
                    <option value="organiser-absorbs">Organiser absorbs</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-qty`} className="text-sm font-medium text-foreground">
                    Quantity available
                  </label>
                  <input
                    id={`ticket-${index}-qty`}
                    type="number"
                    min={1}
                    value={ticket.quantityAvailable}
                    onChange={(e) => updateTicket(index, { quantityAvailable: Number(e.target.value) || 0 })}
                    className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                  />
                  {errors[`ticket-${index}-qty`] && (
                    <p className="text-sm text-danger">{errors[`ticket-${index}-qty`]}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted">
                {ticket.priceCents === 0
                  ? "Free — no booking fee."
                  : `Buyer pays ${formatAud(summary.totalCents)} total (${formatAud(ticket.priceCents)} ticket${
                      summary.buyerFeeCents > 0 ? ` + ${formatAud(summary.buyerFeeCents)} booking fee` : ", fee absorbed by you"
                    }).`}
              </p>
              {ticketTypes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTicket(index)}
                  className="w-fit text-sm text-danger underline underline-offset-2"
                >
                  Remove this ticket type
                </button>
              )}
            </div>
          );
        })}
      </div>

      {submitError && sessionExpired && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
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

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="w-fit rounded bg-accent px-5 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        {initial && (
          <button
            type="button"
            onClick={handleSubmitForReview}
            disabled={submitting}
            className="w-fit rounded border border-surface-border px-5 py-3 font-medium text-foreground hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit for review"}
          </button>
        )}
      </div>
    </form>
  );
}
