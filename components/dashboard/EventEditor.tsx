"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import InlineReauth, { signedInAgainMessage } from "@/components/auth/InlineReauth";
import { ApiError, type GetToken } from "@/lib/api/client";
import AdminOrganiserPicker, { type PickedOrganiser } from "@/components/admin/AdminOrganiserPicker";
import EventClipField from "@/components/dashboard/EventClipField";
import EventImageField from "@/components/dashboard/EventImageField";
import { ClipSyncError, useEventClip, type ClipRoutes } from "@/components/dashboard/useEventClip";
import { fieldClass } from "@/components/ui/Field";
import {
  adminCreateEvent,
  adminDeleteEventImage,
  adminUpdateEvent,
  adminUploadEventImage,
} from "@/lib/api/admin";
import {
  adminAttachClip,
  adminDeleteClip,
  adminRequestClipUpload,
  attachClip,
  deleteClip,
  requestClipUpload,
} from "@/lib/api/clips";
import {
  createEventDraft,
  deleteEventImage,
  submitEventForReview,
  updateEventDraft,
  uploadEventImage,
  type EventInput,
} from "@/lib/api/events";
import type { AdminEventRecord, EventRecord, TicketTypeInput } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { eventClipsEnabled } from "@/lib/clips-flag";
import { calculateOrderSummary, MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { formatAud, toMelbourneDateTimeInputParts } from "@/lib/format";
import { checkExternalTicketUrl, type TicketingMode } from "@/lib/ticketing";
import { EVENT_CATEGORIES } from "@/lib/types";

/** A section title in the form (Panel's title style: 20/24, uppercase by the heading base rule, which a legend doesn't get). */
const SECTION_TITLE = "font-heading text-xl leading-6 uppercase text-foreground";

interface OrganiserProps {
  getToken: GetToken;
  mode?: "organiser";
  initial?: EventRecord;
  onSaved: (record: EventRecord) => void;
  onReload?: never;
  reauthForm?: never;
  onReauthNeeded?: never;
}

/**
 * Admin authoring (/admin/events/new and /admin/events/[eventId]/edit): any
 * status is editable, a new event picks its organiser (or creates a
 * platform-managed one), ticketing is editable, saving can publish, and an
 * edit carries the version it started from (a conflict is reported, with
 * `onReload` to fetch the latest version). Every admin route answers with an
 * AdminEventRecord, and that's what `onSaved` gets.
 */
interface AdminProps {
  getToken: GetToken;
  mode: "admin";
  initial?: AdminEventRecord;
  onSaved: (record: AdminEventRecord) => void;
  /** Fetch the latest version after a save conflict (remount the editor with it). */
  onReload?: () => void;
  /**
   * The admin edit page has one sign-in form for the editor and its Trending
   * panel (InlineReauth's fields have fixed ids). `onReauthNeeded(true)`: a
   * save found the session expired; `(false)`: it no longer needs the form.
   * `reauthForm`: this editor shows the form (default true); otherwise the
   * message points to the Trending panel's, below it.
   */
  reauthForm?: boolean;
  onReauthNeeded?: (needed: boolean) => void;
}

type Props = OrganiserProps | AdminProps;

const PLATFORM_FREE_ONLY = "A platform-managed organiser can only offer free tickets here, or link to another site.";

function isPlatformManaged(record: EventRecord | AdminEventRecord | undefined): boolean {
  return Boolean(record && "organiserPlatformManaged" in record && record.organiserPlatformManaged);
}

/** The organiser's clip routes (their own draft or rejected event). */
const ORGANISER_CLIP_ROUTES: ClipRoutes<EventRecord> = {
  request: requestClipUpload,
  attach: attachClip,
  remove: deleteClip,
};

/** The admin's clip routes (any event, any status), with the save's note for the event's log. */
function adminClipRoutes(reason: string): ClipRoutes<AdminEventRecord> {
  const note = reason || undefined;
  return {
    request: adminRequestClipUpload,
    attach: (eventId, input, getToken) => adminAttachClip(eventId, { ...input, ...(note ? { reason: note } : {}) }, getToken),
    remove: (eventId, getToken) => adminDeleteClip(eventId, getToken, note),
  };
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

export default function EventEditor(props: Props) {
  const { getToken, initial, onReload } = props;
  const router = useRouter();
  const isAdmin = props.mode === "admin";
  // Captured while signed in: the account this draft belongs to, so that if
  // the session expires mid-edit, recovery only accepts signing back in as
  // this same account, and nothing is saved while someone else is signed in
  // (another tab) — never a different one saving over it.
  const { owner, otherAccount } = useAccountOwner();
  const locked = !isAdmin && initial ? initial.status === "pending_review" || initial.status === "published" : false;

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

  const [ticketingMode, setTicketingMode] = useState<TicketingMode>(initial?.ticketingMode ?? "sheltuh");
  const [externalTicketUrl, setExternalTicketUrl] = useState(initial?.externalTicketUrl ?? "");
  const [externalFree, setExternalFree] = useState(initial?.externalFree === true);

  // Admin mode only.
  const [organiser, setOrganiser] = useState<PickedOrganiser | null>(null);
  const platformManaged = initial ? isPlatformManaged(initial) : organiser?.platformManaged === true;
  const [publish, setPublish] = useState(false);
  const [reason, setReason] = useState("");
  // The version being edited (expectedUpdatedAt): the loaded one, then each save's.
  const [version, setVersion] = useState(initial?.updatedAt);
  const [conflict, setConflict] = useState(false);

  const [imageFile, setImageFile] = useState<Blob | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  // Set once the draft exists, so a retry after a failed photo upload updates
  // it instead of creating a duplicate.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // The event's clip (docs/design/event-clips.md §5.4), while clip uploads are switched on. With
  // them off, an admin still sees a clip the event already has, and can describe or remove it
  // (decided at mount, so the field stays after it's removed); only choosing a new one needs the flag.
  const clipsOn = eventClipsEnabled();
  const [clipField] = useState(() => clipsOn || (isAdmin && Boolean(initial?.clip)));
  const clip = useEventClip({ enabled: clipField, getToken, saved: initial?.clip });
  // The event as last saved, here: its photo is what the photo field shows, even when the
  // clip step after it failed (and the page wasn't told, or left).
  const [savedRecord, setSavedRecord] = useState<EventRecord | undefined>(initial);
  const formRef = useRef<HTMLFormElement>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The polite line by the buttons: said after signing in again in a recovery.
  const [status, setStatus] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const reauthForm = props.mode === "admin" ? (props.reauthForm ?? true) : true;

  /** The expired-session message (and the sign-in form, if this editor has it) is shown, or gone. */
  function showSessionExpired(expired: boolean) {
    setSessionExpired(expired);
    if (props.mode === "admin" && (expired || sessionExpired)) props.onReauthNeeded?.(expired);
  }

  /** Someone else is signed in by now (another tab): open the recovery, which takes only this draft's account. */
  function refuseOtherAccount(): boolean {
    if (!otherAccount) return false;
    showSessionExpired(true);
    setSubmitError(new SessionExpiredError().message);
    return true;
  }

  function handleError(err: unknown, fallback: string) {
    // The clip step failed or was cancelled: the clip field already says why (the event itself was saved).
    if (err instanceof ClipSyncError) return;
    if (err instanceof SessionExpiredError) {
      showSessionExpired(true);
      setSubmitError(err.message);
      return;
    }
    if (isAdmin && err instanceof ApiError && err.status === 409 && err.fieldErrors?.expectedUpdatedAt) {
      setConflict(true);
      setSubmitError(null);
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
    if (isAdmin && !initial && !createdId && !organiser) nextErrors.organiserId = "Choose an organiser.";
    const external = ticketingMode === "external";
    if (external) {
      // Only an admin edits the link here; an organiser's external event keeps its stored one.
      if (isAdmin) {
        const checked = checkExternalTicketUrl(externalTicketUrl.trim());
        if (!externalTicketUrl.trim()) nextErrors.externalTicketUrl = "Enter the address of the page where tickets are sold.";
        else if (!checked.ok) nextErrors.externalTicketUrl = checked.message;
      }
    } else {
      if (ticketTypes.length === 0) nextErrors.ticketTypes = "Add at least one ticket type.";
      ticketTypes.forEach((t, i) => {
        if (!t.name.trim()) nextErrors[`ticket-${i}-name`] = "Enter a ticket name.";
        if (!Number.isInteger(t.priceCents) || t.priceCents < 0) nextErrors[`ticket-${i}-price`] = "Enter a valid price.";
        else if (t.priceCents > 0 && platformManaged) nextErrors[`ticket-${i}-price`] = PLATFORM_FREE_ONLY;
        else if (t.priceCents > 0 && t.priceCents < MIN_PAID_TICKET_CENTS)
          nextErrors[`ticket-${i}-price`] = `A paid ticket must cost at least ${formatAud(MIN_PAID_TICKET_CENTS)} (or make it free).`;
        if (!Number.isInteger(t.quantityAvailable) || t.quantityAvailable < 1)
          nextErrors[`ticket-${i}-qty`] = "Enter how many are available.";
      });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return null;

    const input: EventInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      suburb: suburb.trim(),
      start,
      end,
      ticketTypes: external ? [] : ticketTypes,
    };
    // Ticketing is sent by an admin, and for an organiser's external event
    // (unchanged, so saving never turns it back into a Sheltüh-ticketed one).
    if (isAdmin || external) {
      input.ticketingMode = ticketingMode;
      input.externalTicketUrl = external ? (isAdmin ? externalTicketUrl.trim() : (initial?.externalTicketUrl ?? null)) : null;
      input.externalFree = external && externalFree;
    }
    return input;
  }

  /**
   * Applies a pending photo change to a saved event through `upload` or
   * `remove` (the organiser's routes or the admin's, which answer with the
   * same kind of record they're given); returns the latest record.
   */
  async function syncImage<R extends EventRecord>(
    record: R,
    upload: (eventId: string, image: Blob, getToken: GetToken) => Promise<R>,
    remove: (eventId: string, getToken: GetToken) => Promise<R>,
  ): Promise<R> {
    if (imageFile) {
      const updated = await upload(record.eventId, imageFile, getToken);
      setImageFile(null);
      return updated;
    }
    if (imageRemoved && record.imageUrl) {
      const updated = await remove(record.eventId, getToken);
      setImageRemoved(false);
      return updated;
    }
    return record;
  }

  /** Admin mode: creates the event, or saves the whole of it against the version being edited. */
  async function adminSave(input: EventInput): Promise<AdminEventRecord> {
    const existingId = initial?.eventId ?? createdId;
    if (existingId) {
      const record = await adminUpdateEvent(
        existingId,
        { ...input, ticketingMode, expectedUpdatedAt: version ?? "", publish, reason: reason.trim() || null },
        getToken,
      );
      setVersion(record.updatedAt);
      return record;
    }
    const record = await adminCreateEvent({ ...input, organiserId: organiser?.organiserId ?? "", publish }, getToken);
    setCreatedId(record.eventId);
    setVersion(record.updatedAt);
    return record;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    showSessionExpired(false);
    setStatus(null);
    const input = buildInput();
    if (input && refuseOtherAccount()) return;
    // Busy already: the clip's check may still be reading a file just chosen, which the save waits for.
    setSaving(true);
    const clipReady = await clip.validate();
    if (!input || !clipReady) {
      setSaving(false);
      return;
    }

    setConflict(false);
    try {
      if (props.mode === "admin") {
        const note = reason.trim();
        let record = await adminSave(input);
        setPublish(false);
        record = await syncImage(record, adminUploadEventImage, adminDeleteEventImage);
        // A photo change bumps the event's version too: the next save is made against it.
        setVersion(record.updatedAt);
        // So does a clip change: the admin routes answer with the event, whose version is the next.
        const onSaved = props.onSaved;
        record = await syncClip(record, adminClipRoutes(note), (kept) => {
          // The save is in the event's log with this note now.
          setReason("");
          if (initial) onSaved(kept);
        });
        setVersion(record.updatedAt);
        setSavedRecord(record);
        if (!initial) {
          router.push(`/admin/events/${encodeURIComponent(record.eventId)}/edit`);
          return;
        }
        setReason("");
        props.onSaved(record);
      } else {
        const existingId = initial?.eventId ?? createdId;
        let record = existingId
          ? await updateEventDraft(existingId, input, getToken)
          : await createEventDraft(input, getToken);
        if (!existingId) setCreatedId(record.eventId);
        record = await syncImage(record, uploadEventImage, deleteEventImage);
        const onSaved = props.onSaved;
        record = await syncClip(record, ORGANISER_CLIP_ROUTES, (kept) => {
          if (initial) onSaved(kept);
        });
        setSavedRecord(record);
        if (!initial) {
          router.push(`/dashboard/${record.eventId}`);
          return;
        }
        props.onSaved(record);
      }
    } catch (err) {
      // Never clears title/description/tickets/etc. above — a failed save
      // (including an expired session) leaves the form exactly as typed.
      handleError(err, "Couldn't save this event.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * The clip step, after the event and its photo were saved. If it doesn't finish (refused,
   * cancelled, or the session ran out), that saved record is kept here, so the photo and the
   * version are the server's, and `kept` gets it (to tell the page of an existing event, as a
   * save does); then the error goes on, so a new event isn't navigated to and nothing is submitted.
   */
  async function syncClip<R extends EventRecord>(record: R, routes: ClipRoutes<R>, kept: (record: R) => void): Promise<R> {
    try {
      return await clip.sync(record, routes);
    } catch (err) {
      setSavedRecord(record);
      kept(record);
      throw err;
    }
  }

  async function handleSubmitForReview() {
    // Organisers only: an admin publishes from the save itself.
    if (!initial || props.mode === "admin") return;
    setSubmitError(null);
    showSessionExpired(false);
    setStatus(null);
    // Submit what's on screen, not the last save: unsaved edits are saved
    // first, and nothing is submitted if they don't validate.
    const input = buildInput();
    if (input && refuseOtherAccount()) return;
    setSubmitting(true);
    const clipReady = await clip.validate();
    if (!input || !clipReady) {
      setSubmitting(false);
      return;
    }
    try {
      const saved = await updateEventDraft(initial.eventId, input, getToken);
      const withImage = await syncImage(saved, uploadEventImage, deleteEventImage);
      // Waits for a clip upload a save already started, and never submits without the clip.
      setSavedRecord(await syncClip(withImage, ORGANISER_CLIP_ROUTES, props.onSaved));
      const record = await submitEventForReview(initial.eventId, getToken);
      props.onSaved(record);
    } catch (err) {
      handleError(err, "Couldn't submit this event for review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return (
      <div className="bg-surface p-4 text-foreground">
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
    <form ref={formRef} onSubmit={handleSave} className="flex flex-col gap-6" noValidate>
      {initial?.status === "rejected" && initial.rejectionReason && (
        <div className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Not approved — reviewer note:</p>
          <p className="mt-1 text-muted">{initial.rejectionReason}</p>
        </div>
      )}

      {isAdmin && (initial || createdId) && (
        <div className="flex flex-col gap-1 bg-surface p-4 text-sm text-foreground">
          <p>
            <span className="font-medium">Organiser:</span> {initial?.organiserName ?? organiser?.displayName}
            {platformManaged && " (platform-managed)"}
          </p>
          {initial?.status === "published" && (
            <p className="text-muted">This event is published: your changes go live as soon as you save.</p>
          )}
        </div>
      )}
      {isAdmin && !initial && !createdId && (
        <AdminOrganiserPicker
          getToken={getToken}
          value={organiser}
          onChange={(picked) => {
            setOrganiser(picked);
            setErrors((prev) => {
              const next = { ...prev };
              delete next.organiserId;
              return next;
            });
          }}
          error={errors.organiserId}
        />
      )}
      {isAdmin && platformManaged && (
        <p className="border-l-2 border-foreground px-4 py-2 text-sm text-muted">
          {PLATFORM_FREE_ONLY} Its events are checked in at the door by an admin.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="eyebrow text-muted">
          Title
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />
        {errors.title && <p className="text-sm text-danger">{errors.title}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="eyebrow text-muted">
          Description
        </label>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={fieldClass}
        />
        {errors.description && <p className="text-sm text-danger">{errors.description}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="eyebrow text-muted">
          Category
        </label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className={fieldClass}
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
          <label htmlFor="venueName" className="eyebrow text-muted">
            Venue name
          </label>
          <input
            id="venueName"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            className={fieldClass}
          />
          {errors.venueName && <p className="text-sm text-danger">{errors.venueName}</p>}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="venueAddress" className="eyebrow text-muted">
            Venue address
          </label>
          <input
            id="venueAddress"
            value={venueAddress}
            onChange={(e) => setVenueAddress(e.target.value)}
            className={fieldClass}
          />
          {errors.venueAddress && <p className="text-sm text-danger">{errors.venueAddress}</p>}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="suburb" className="eyebrow text-muted">
            Suburb
          </label>
          <input
            id="suburb"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
            className={fieldClass}
          />
          {errors.suburb && <p className="text-sm text-danger">{errors.suburb}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow text-muted">Starts (Melbourne time)</legend>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
            <input
              type="date"
              aria-label="Start date"
              value={start.date}
              onChange={(e) => setStart((s) => ({ ...s, date: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
            <input
              type="time"
              aria-label="Start time"
              value={start.time}
              onChange={(e) => setStart((s) => ({ ...s, time: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
          </div>
          {(errors.start || errors.end) && <p className="text-sm text-danger">{errors.start || errors.end}</p>}
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow text-muted">Ends (Melbourne time)</legend>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
            <input
              type="date"
              aria-label="End date"
              value={end.date}
              onChange={(e) => setEnd((s) => ({ ...s, date: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
            <input
              type="time"
              aria-label="End time"
              value={end.time}
              onChange={(e) => setEnd((s) => ({ ...s, time: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
          </div>
        </fieldset>
      </div>

      <EventImageField
        getToken={getToken}
        existingUrl={savedRecord?.imageUrl}
        pending={imageFile}
        onPendingChange={setImageFile}
        removed={imageRemoved}
        onRemovedChange={setImageRemoved}
        error={errors.image}
      />

      {clipField && (
        <EventClipField
          draft={clip}
          getToken={getToken}
          canUpload={clipsOn}
          eventId={initial?.eventId ?? createdId ?? undefined}
          // The upload stopped: save again (the event, then the clip).
          onRetry={() => formRef.current?.requestSubmit()}
        />
      )}

      {isAdmin && (
        <fieldset className="flex flex-col gap-3">
          <legend className={SECTION_TITLE}>Where are tickets sold?</legend>
          <div className="flex flex-wrap gap-5 text-sm text-foreground">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ticketingMode"
                value="sheltuh"
                checked={ticketingMode === "sheltuh"}
                onChange={() => setTicketingMode("sheltuh")}
              />
              On Sheltüh
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ticketingMode"
                value="external"
                checked={ticketingMode === "external"}
                onChange={() => setTicketingMode("external")}
              />
              On another site
            </label>
          </div>
          {errors.ticketingMode && <p className="text-sm text-danger">{errors.ticketingMode}</p>}
          {ticketingMode === "external" && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="externalTicketUrl" className="eyebrow text-muted">
                  Ticket page address
                </label>
                <input
                  id="externalTicketUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={externalTicketUrl}
                  onChange={(e) => setExternalTicketUrl(e.target.value)}
                  aria-invalid={Boolean(errors.externalTicketUrl)}
                  aria-describedby={errors.externalTicketUrl ? "externalTicketUrl-error" : undefined}
                  className={fieldClass}
                />
                {errors.externalTicketUrl && (
                  <p id="externalTicketUrl-error" className="text-sm text-danger">
                    {errors.externalTicketUrl}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={externalFree} onChange={(e) => setExternalFree(e.target.checked)} />
                Entry is free
              </label>
            </>
          )}
        </fieldset>
      )}

      {!isAdmin && ticketingMode === "external" && (
        <div className="bg-surface p-4 text-sm text-foreground">
          <p className="font-medium">Tickets are sold on {initial?.externalProvider ?? "the organiser\u2019s site"}</p>
          <p className="mt-1 break-all text-muted">{initial?.externalTicketUrl}</p>
        </div>
      )}

      {ticketingMode === "sheltuh" && (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={SECTION_TITLE}>Ticket types</h2>
          <button
            type="button"
            onClick={() => setTicketTypes((prev) => [...prev, newTicketType()])}
            className="btn btn-outline"
          >
            Add ticket type
          </button>
        </div>
        {errors.ticketTypes && <p className="text-sm text-danger">{errors.ticketTypes}</p>}

        {ticketTypes.map((ticket, index) => {
          const summary = calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy);
          return (
            <div key={ticket.id} className="flex flex-col gap-3 border-t border-foreground pt-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-name`} className="eyebrow text-muted">
                    Name
                  </label>
                  <input
                    id={`ticket-${index}-name`}
                    value={ticket.name}
                    onChange={(e) => updateTicket(index, { name: e.target.value })}
                    className={fieldClass}
                  />
                  {errors[`ticket-${index}-name`] && (
                    <p className="text-sm text-danger">{errors[`ticket-${index}-name`]}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-price`} className="eyebrow text-muted">
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
                    className={fieldClass}
                  />
                  {errors[`ticket-${index}-price`] && (
                    <p className="text-sm text-danger">{errors[`ticket-${index}-price`]}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-fee-policy`} className="eyebrow text-muted">
                    Who pays the booking fee?
                  </label>
                  <select
                    id={`ticket-${index}-fee-policy`}
                    value={ticket.feePolicy}
                    onChange={(e) => updateTicket(index, { feePolicy: e.target.value as TicketTypeInput["feePolicy"] })}
                    className={fieldClass}
                  >
                    <option value="buyer-pays">Buyer pays</option>
                    <option value="organiser-absorbs">Organiser absorbs</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-qty`} className="eyebrow text-muted">
                    Quantity available
                  </label>
                  <input
                    id={`ticket-${index}-qty`}
                    type="number"
                    min={1}
                    value={ticket.quantityAvailable}
                    onChange={(e) => updateTicket(index, { quantityAvailable: Number(e.target.value) || 0 })}
                    className={fieldClass}
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
                      summary.buyerFeeCents > 0
                        ? ` + ${formatAud(summary.buyerFeeCents)} booking fee`
                        : isAdmin
                          ? ", fee absorbed by the organiser"
                          : ", fee absorbed by you"
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
      )}

      {isAdmin && initial && (
        <div className="flex flex-col gap-1">
          <label htmlFor="admin-reason" className="eyebrow text-muted">
            Note for the event&rsquo;s log (optional; the organiser sees it)
          </label>
          <textarea
            id="admin-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={errors.reason ? "admin-reason-error" : "admin-reason-hint"}
            className={fieldClass}
          />
          {errors.reason ? (
            <p id="admin-reason-error" className="text-sm text-danger">
              {errors.reason}
            </p>
          ) : (
            <p id="admin-reason-hint" className="text-xs text-muted">
              Needed to change where an approved event&rsquo;s tickets are sold.
            </p>
          )}
        </div>
      )}

      {isAdmin && initial?.status !== "published" && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
          {initial || createdId ? "Publish when saved" : "Publish straight away"}
        </label>
      )}

      {conflict && (
        <div role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          <p className="font-medium">Someone else changed this event since you opened it.</p>
          <p className="mt-1 text-muted">
            Your changes haven&rsquo;t been saved. Reload to see the latest version, then make your changes again
            (reloading discards what you&rsquo;ve typed here).
          </p>
          {onReload && (
            <button type="button" onClick={onReload} className="btn btn-outline btn-sm mt-3 w-fit">
              Reload latest version
            </button>
          )}
        </div>
      )}

      {submitError && sessionExpired && (
        <div role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
          <p>{submitError}</p>
          {reauthForm ? (
            <InlineReauth
              expectedAccount={owner}
              onSignedIn={() => {
                showSessionExpired(false);
                setSubmitError(null);
                setStatus(signedInAgainMessage("save"));
                saveRef.current?.focus();
              }}
            />
          ) : (
            <p>Sign in again with the form below (under Trending), then save again.</p>
          )}
        </div>
      )}
      {submitError && !sessionExpired && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      {/* Always rendered (never display:none), so it's announced when its text changes. */}
      <p role="status" className="text-sm text-foreground empty:sr-only">
        {status}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          ref={saveRef}
          type="submit"
          disabled={saving}
          className="btn btn-solid w-fit"
        >
          {saving ? "Saving…" : isAdmin ? (initial || createdId ? "Save changes" : "Create event") : "Save draft"}
        </button>
        {initial && !isAdmin && (
          <button
            type="button"
            onClick={handleSubmitForReview}
            disabled={submitting}
            className="btn btn-outline w-fit"
          >
            {submitting ? "Submitting…" : "Submit for review"}
          </button>
        )}
      </div>
    </form>
  );
}
