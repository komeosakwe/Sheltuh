"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import InlineReauth, { signedInAgainMessage } from "@/components/auth/InlineReauth";
import { ApiError, type GetToken } from "@/lib/api/client";
import AdminOrganiserPicker, { type PickedOrganiser } from "@/components/admin/AdminOrganiserPicker";
import EventClipField from "@/components/dashboard/EventClipField";
import EventImageField from "@/components/dashboard/EventImageField";
import { PayoutsNeededNotice, PayoutsSubmitError, PayoutsSubmitHint } from "@/components/dashboard/PayoutsRequired";
import RefundPolicyField from "@/components/dashboard/RefundPolicyField";
import VenueSuburbField, {
  hasZoneChoice,
  useVenuePlace,
  VENUE_SUBURB_ID,
  VENUE_TIME_ZONE_ID,
  VenueZoneField,
  venueZoneName,
  type VenueResolution,
} from "@/components/dashboard/VenueSuburbField";
import SeatingChoiceField, {
  initialSeatingChoice,
  seatMapHref,
  type SeatingChoice,
} from "@/components/dashboard/SeatingChoice";
import { ClipSyncError, useEventClip, type ClipRoutes } from "@/components/dashboard/useEventClip";
import { Button } from "@/components/ui/Button";
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
  isPayoutsRequiredError,
  isRefundPolicyTightenedError,
  submitEventForReview,
  updateEventDraft,
  uploadEventImage,
  type EventInput,
} from "@/lib/api/events";
import type { AdminEventRecord, EventRecord, TicketTypeInput } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { eventClipsEnabled } from "@/lib/clips-flag";
import { calculateBookingFeeCents, calculateOrderSummary, describeBookingFee, MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { formatAud, toDateTimeInputParts } from "@/lib/format";
import {
  DEFAULT_REFUND_POLICY,
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  type RefundPolicy,
} from "@/lib/refund-policy";
import { checkExternalTicketUrl, sellsPaidTicketsOnSheltuh, type TicketingMode } from "@/lib/ticketing";
import { localToUtcIso, PLATFORM_TIME_ZONE, zoneShortLabel } from "@/lib/time-zones";
import { EVENT_CATEGORIES } from "@/lib/types";

/** A section title in the form (Panel's title style: 20/24, uppercase by the heading base rule, which a legend doesn't get). */
const SECTION_TITLE = "font-heading text-xl leading-6 uppercase text-foreground";

interface OrganiserProps {
  getToken: GetToken;
  mode?: "organiser";
  initial?: EventRecord;
  onSaved: (record: EventRecord) => void;
  /**
   * The organiser's `payoutsEnabled` (GET /api/organisers/me); undefined while
   * it isn't known. False: an event with paid Sheltüh tickets says, by its
   * tickets and its Submit button, that payouts come first (submitting it is
   * refused with 409 `payouts_required`). Saving a draft never needs them.
   */
  payoutsEnabled?: boolean;
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
  payoutsEnabled?: never;
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

/** A field error's element id: the control's id plus "-error" (`refundDays` → `refundDays-error`). */
function errorId(key: string): string {
  return `${key}-error`;
}

/**
 * The control to focus for each error (this form's, or the API's
 * fieldErrors), in the form's order: the first one present is focused when
 * a save doesn't validate or is refused. A zone error goes to the zone
 * choice while it's shown (`zoneChoice`), else to the suburb it comes from.
 */
function invalidControlIds(
  errors: Record<string, string>,
  ticketCount: number,
  start: { date: string },
  end: { date: string },
  zoneChoice: boolean,
): string[] {
  const order: [string, string][] = [
    ["organiserId", "organiserId"],
    ["title", "title"],
    ["description", "description"],
    ["venueName", "venueName"],
    ["venueAddress", "venueAddress"],
    ["suburb", VENUE_SUBURB_ID],
    ["state", VENUE_SUBURB_ID],
    ["timeZone", zoneChoice ? VENUE_TIME_ZONE_ID : VENUE_SUBURB_ID],
    ["start", start.date ? "start-time" : "start-date"],
    ["end", end.date ? "end-time" : "end-date"],
    ["externalTicketUrl", "externalTicketUrl"],
    ["ticketTypes", "add-ticket-type"],
  ];
  for (let i = 0; i < ticketCount; i++) {
    for (const field of ["name", "price", "qty"]) order.push([`ticket-${i}-${field}`, `ticket-${i}-${field}`]);
  }
  order.push(["refundDays", "refundDays"]);
  return order.filter(([key]) => errors[key]).map(([, id]) => id);
}

/** The event's start as an instant, once both parts are filled in and real (in the event's zone); undefined otherwise. */
function startInstant(start: { date: string; time: string }, timeZone: string): string | undefined {
  if (!start.date || !start.time) return undefined;
  try {
    return localToUtcIso(start.date, start.time, timeZone);
  } catch {
    // Not a real local time yet (half-typed, or in the daylight-saving gap): no preview date.
    return undefined;
  }
}

export default function EventEditor(props: Props) {
  const { getToken, initial, onReload } = props;
  const router = useRouter();
  const isAdmin = props.mode === "admin";
  // Captured while signed in: the account this draft belongs to, so that if
  // the session expires mid-edit, recovery only accepts signing back in as
  // this same account, and nothing is saved while someone else is signed in
  // (another tab) — never a different one saving over it. Every request a
  // save makes (the event, its photo, its clip; an admin's new organiser)
  // uses `saveToken`, bound to this account when it's called; `getToken`
  // (the page's) is only for reading (photo and clip previews).
  const { owner, otherAccount, getOwnerToken: saveToken } = useAccountOwner();
  const locked = !isAdmin && initial ? initial.status === "pending_review" || initial.status === "published" : false;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? EVENT_CATEGORIES[0].value);
  const [venueName, setVenueName] = useState(initial?.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(initial?.venueAddress ?? "");
  // The venue's suburb, and from it the event's state and time zone (owner plan S8), sent together.
  const venue = useVenuePlace(initial);
  // The zone the date and time inputs are in: the suburb's (or the zone chosen for it). Until that's
  // known, the saved event's own, Melbourne for a new one; the inputs keep their wall-clock times
  // when the place changes.
  const timeZone = venue.place?.timeZone ?? initial?.timeZone ?? PLATFORM_TIME_ZONE;
  // "Perth time" (the ACT's "Canberra time"), or "local time" while the suburb isn't known.
  const zoneName = venueZoneName(venue.place);
  const zoneChoice = hasZoneChoice(venue.place);
  const initialZone = initial?.timeZone ?? PLATFORM_TIME_ZONE;
  const [start, setStart] = useState(initial ? toDateTimeInputParts(initial.startsAt, initialZone) : { date: "", time: "" });
  const [end, setEnd] = useState(initial ? toDateTimeInputParts(initial.endsAt, initialZone) : { date: "", time: "" });
  // The times keep their wall-clock values when the place's zone changes, so the instant moves: say
  // so by them ("Times are now Melbourne time (were Perth time)."). `shownZone`: the last known
  // place's zone (a saved event's own to start with; none for a new one, whose legends said
  // "local time"), updated while rendering when the place's zone changes.
  const [shownZone, setShownZone] = useState<string | null>(
    initial?.timeZone ? zoneShortLabel(initial.timeZone, initial.state) : null,
  );
  const [zoneNote, setZoneNote] = useState("");
  if (venue.place && zoneName !== shownZone) {
    setShownZone(zoneName);
    const timesTyped = Boolean(start.date || start.time || end.date || end.time);
    setZoneNote(shownZone && timesTyped ? `Times are now ${zoneName} (were ${shownZone}).` : "");
  }
  const [ticketTypes, setTicketTypes] = useState<TicketTypeInput[]>(
    initial?.ticketTypes && initial.ticketTypes.length > 0 ? initial.ticketTypes : [newTicketType()],
  );

  const [ticketingMode, setTicketingMode] = useState<TicketingMode>(initial?.ticketingMode ?? "sheltuh");
  const [externalTicketUrl, setExternalTicketUrl] = useState(initial?.externalTicketUrl ?? "");
  const [externalFree, setExternalFree] = useState(initial?.externalFree === true);
  // Reserved seating (docs/design/seating.md §5.13): not a field of its own. An existing
  // event's comes from its seat map; a new event's decides where saving goes next.
  const [seatingChoice, setSeatingChoice] = useState<SeatingChoice>(() => initialSeatingChoice(initial));
  // Only for Sheltüh-ticketed events: a seat map can't go with external ticketing.
  const reservedSeating = ticketingMode === "sheltuh" && seatingChoice === "reserved";
  // The refund policy (Sheltüh-ticketed events only; docs/architecture.md, "Refund policy"). The days
  // are kept as typed, and while the other option is chosen, so switching back doesn't lose them.
  const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>(initial?.refundPolicy ?? DEFAULT_REFUND_POLICY);
  const [refundDays, setRefundDays] = useState(initial?.refundDays !== undefined ? String(initial.refundDays) : "");

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
  const clip = useEventClip({ enabled: clipField, getToken: saveToken, saved: initial?.clip });
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
  // Organisers: the submit was refused because payouts aren't set up (the server's message), and
  // so they're known to be off whatever the page loaded. Focus goes to the message once it's shown.
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [payoutsRefused, setPayoutsRefused] = useState(false);
  const payoutsErrorRef = useRef<HTMLDivElement>(null);
  const focusPayoutsError = useRef(false);
  // A save refused for making the refund policy less generous: focus goes to the days (from one number
  // of days to another), else to the policy's chosen option.
  const refundChoiceRef = useRef<HTMLInputElement>(null);
  const refundDaysRef = useRef<HTMLInputElement>(null);
  const focusRefund = useRef<"choice" | "days" | null>(null);
  // A save that didn't validate here: focus goes to the first field that needs fixing, once its error is shown.
  const focusInvalidId = useRef<string | null>(null);

  useEffect(() => {
    if (focusInvalidId.current) {
      const element = document.getElementById(focusInvalidId.current);
      focusInvalidId.current = null;
      element?.focus();
    }
    if (focusRefund.current) {
      const element = focusRefund.current === "days" ? refundDaysRef.current : refundChoiceRef.current;
      if (element) {
        focusRefund.current = null;
        element.focus();
      }
    }
    if (!focusPayoutsError.current || !payoutsErrorRef.current) return;
    focusPayoutsError.current = false;
    payoutsErrorRef.current.focus();
  });

  // Paid Sheltüh tickets, as on screen, while the organiser's payouts are off: submitting will be refused.
  const payoutsNeeded =
    props.mode !== "admin" &&
    (props.payoutsEnabled === false || payoutsRefused) &&
    sellsPaidTicketsOnSheltuh({ ticketingMode, ticketTypes });
  const submitDescription = payoutsError ? "submit-payouts-error" : payoutsNeeded ? "submit-payouts-hint" : undefined;

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
    // An organiser's submit, refused until their payouts are set up: the reason and the way to fix it, focused.
    // (An admin's save gets it as any other refusal: fieldErrors.ticketTypes by the tickets, the message below.)
    if (!isAdmin && isPayoutsRequiredError(err)) {
      setPayoutsRefused(true);
      setPayoutsError(err.message);
      focusPayoutsError.current = true;
      return;
    }
    // The event has orders, and the policy may only become more generous: the reason is by the policy
    // (fieldErrors.refundPolicy), focus goes there, and the line by the buttons points to it.
    if (isRefundPolicyTightenedError(err)) {
      setErrors((prev) => ({ ...prev, ...err.fieldErrors, refundPolicy: err.fieldErrors?.refundPolicy ?? err.message }));
      setSubmitError("Not saved: the refund policy can\u2019t be made less generous now. See Refund policy.");
      // From one number of days to more: the days are what to change. Otherwise the choice is.
      const saved = savedRecord ?? initial;
      focusRefund.current = saved?.refundPolicy === "days_before" && refundPolicy === "days_before" ? "days" : "choice";
      return;
    }
    if (err instanceof ApiError && err.fieldErrors) {
      const fieldErrors = err.fieldErrors;
      setErrors((prev) => ({ ...prev, ...fieldErrors }));
      // Focus the first field the API refused, as for this form's own errors (its message is read with it).
      focusInvalidId.current = invalidControlIds(fieldErrors, ticketTypes.length, start, end, zoneChoice)[0] ?? null;
    }
    setSubmitError(err instanceof Error ? err.message : fallback);
  }

  /** Fields were edited: their old errors (ours or the server's) no longer apply. */
  function clearErrors(...keys: string[]) {
    setErrors((prev) => {
      if (!keys.some((key) => prev[key])) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  /** A refund field changed: its old error (ours or the server's) no longer applies. */
  function clearRefundErrors() {
    setErrors((prev) => {
      if (!prev.refundPolicy && !prev.refundDays) return prev;
      const next = { ...prev };
      delete next.refundPolicy;
      delete next.refundDays;
      return next;
    });
  }

  function updateTicket(index: number, patch: Partial<TicketTypeInput>) {
    setTicketTypes((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTicket(index: number) {
    setTicketTypes((prev) => prev.filter((_, i) => i !== index));
  }

  /** The days as typed, as a number (NaN when it isn't one: blank, or not a number). */
  function refundDaysNumber(): number {
    return refundDays.trim() === "" ? Number.NaN : Number(refundDays);
  }

  /**
   * The form as the API takes it, or null with the errors shown. `place`: the
   * suburb resolved (useVenuePlace's resolveForSave): a suburb the table
   * doesn't know, or one that couldn't be checked, is an error by the field,
   * and nothing is sent; a known one sends its state and zone with it.
   */
  function buildInput(place: VenueResolution): EventInput | null {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) nextErrors.title = "Enter an event title.";
    if (!description.trim()) nextErrors.description = "Enter a description.";
    if (!venueName.trim()) nextErrors.venueName = "Enter a venue name.";
    if (!venueAddress.trim()) nextErrors.venueAddress = "Enter a venue address.";
    if (place.kind === "empty") nextErrors.suburb = "Enter a suburb or town.";
    else if (place.kind === "unknown" || place.kind === "unavailable") nextErrors.suburb = place.message;
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
      if (refundPolicy === "days_before" && !isValidRefundDays(refundDaysNumber()))
        nextErrors.refundDays = `Enter a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Focus the first field to fix (its error is read with it), and say how many there are by the buttons.
      focusInvalidId.current = invalidControlIds(nextErrors, ticketTypes.length, start, end, zoneChoice)[0] ?? null;
      const count = Object.keys(nextErrors).length;
      setStatus(`Not saved: ${count === 1 ? "1 field needs" : `${count} fields need`} fixing. The first one is focused.`);
      return null;
    }

    const input: EventInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      venueName: venueName.trim(),
      venueAddress: venueAddress.trim(),
      ...(place.kind === "found"
        ? { suburb: place.place.name, state: place.place.state, timeZone: place.place.timeZone }
        : { suburb: venue.suburb.trim() }),
      start,
      end,
      ticketTypes: external ? [] : ticketTypes,
    };
    // The refund policy is for tickets sold here: an external event's is left as stored (not sent).
    if (!external) {
      input.refundPolicy = refundPolicy;
      if (refundPolicy === "days_before") input.refundDays = refundDaysNumber();
    }
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
      const updated = await upload(record.eventId, imageFile, saveToken);
      setImageFile(null);
      return updated;
    }
    if (imageRemoved && record.imageUrl) {
      const updated = await remove(record.eventId, saveToken);
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
        saveToken,
      );
      setVersion(record.updatedAt);
      return record;
    }
    const record = await adminCreateEvent({ ...input, organiserId: organiser?.organiserId ?? "", publish }, saveToken);
    setCreatedId(record.eventId);
    setVersion(record.updatedAt);
    return record;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setPayoutsError(null);
    showSessionExpired(false);
    setStatus(null);
    // Busy already: the suburb may need checking (the table loading), and the clip's check may
    // still be reading a file just chosen, which the save waits for.
    setSaving(true);
    const input = buildInput(await venue.resolveForSave());
    if (input && refuseOtherAccount()) {
      setSaving(false);
      return;
    }
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
          // Reserved seating: on to the new event's seat map, to add the seats.
          router.push(
            reservedSeating
              ? seatMapHref(record.eventId, true)
              : `/admin/events/${encodeURIComponent(record.eventId)}/edit`,
          );
          return;
        }
        setReason("");
        props.onSaved(record);
      } else {
        const existingId = initial?.eventId ?? createdId;
        let record = existingId
          ? await updateEventDraft(existingId, input, saveToken)
          : await createEventDraft(input, saveToken);
        if (!existingId) setCreatedId(record.eventId);
        record = await syncImage(record, uploadEventImage, deleteEventImage);
        const onSaved = props.onSaved;
        record = await syncClip(record, ORGANISER_CLIP_ROUTES, (kept) => {
          if (initial) onSaved(kept);
        });
        setSavedRecord(record);
        if (!initial) {
          // Reserved seating: on to the new draft's seat map, to lay out the seats.
          router.push(reservedSeating ? seatMapHref(record.eventId, false) : `/dashboard/${record.eventId}`);
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
    setPayoutsError(null);
    showSessionExpired(false);
    setStatus(null);
    // Submit what's on screen, not the last save: unsaved edits are saved
    // first, and nothing is submitted if they don't validate.
    setSubmitting(true);
    const input = buildInput(await venue.resolveForSave());
    if (input && refuseOtherAccount()) {
      setSubmitting(false);
      return;
    }
    const clipReady = await clip.validate();
    if (!input || !clipReady) {
      setSubmitting(false);
      return;
    }
    try {
      const saved = await updateEventDraft(initial.eventId, input, saveToken);
      const withImage = await syncImage(saved, uploadEventImage, deleteEventImage);
      // Waits for a clip upload a save already started, and never submits without the clip.
      setSavedRecord(await syncClip(withImage, ORGANISER_CLIP_ROUTES, props.onSaved));
      const record = await submitEventForReview(initial.eventId, saveToken);
      props.onSaved(record);
    } catch (err) {
      handleError(err, "Couldn't submit this event for review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    // The same words as the dashboard's status badge (lib/organiser-events.ts).
    const published = initial?.status === "published";
    return (
      <div className="bg-surface p-4 text-foreground">
        <h2 className="font-heading text-xl">{published ? "Published" : "Waiting for review"}</h2>
        <p className="mt-2 text-sm text-muted">
          This event can&rsquo;t be edited while it&rsquo;s {published ? "published" : "waiting for review"}.
        </p>
      </div>
    );
  }

  /** A field's error wiring: aria-invalid, and aria-describedby pointing at its error, while it has one. */
  function invalidProps(key: string) {
    return {
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": errors[key] ? errorId(key) : undefined,
    };
  }

  /** A field's error message, with the id invalidProps points at. */
  function fieldError(name: string) {
    if (!errors[name]) return null;
    return (
      <p id={errorId(name)} className="text-sm text-danger">
        {errors[name]}
      </p>
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
          getToken={saveToken}
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
          {...invalidProps("title")}
          onChange={(e) => setTitle(e.target.value)}
          className={fieldClass}
        />
        {fieldError("title")}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="eyebrow text-muted">
          Description
        </label>
        <textarea
          id="description"
          rows={4}
          value={description}
          {...invalidProps("description")}
          onChange={(e) => setDescription(e.target.value)}
          className={fieldClass}
        />
        {fieldError("description")}
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
            {...invalidProps("venueName")}
            onChange={(e) => setVenueName(e.target.value)}
            className={fieldClass}
          />
          {fieldError("venueName")}
        </div>
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label htmlFor="venueAddress" className="eyebrow text-muted">
            Venue address
          </label>
          <input
            id="venueAddress"
            value={venueAddress}
            {...invalidProps("venueAddress")}
            onChange={(e) => setVenueAddress(e.target.value)}
            className={fieldClass}
          />
          {fieldError("venueAddress")}
        </div>
        <div className="sm:col-span-1">
          <VenueSuburbField
            venue={venue}
            suburbError={errors.suburb ?? errors.state}
            timeZoneError={errors.timeZone}
            startsAt={startInstant(start, timeZone)}
            // The place (and with it the zone) comes from the suburb: all three errors go with it.
            onSuburbEdit={() => clearErrors("suburb", "state", "timeZone")}
          />
        </div>
        {zoneChoice && (
          // A row of its own, so the zones' names have room.
          <div className="sm:col-span-3">
            <VenueZoneField venue={venue} timeZoneError={errors.timeZone} onZoneEdit={() => clearErrors("timeZone")} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow text-muted">Starts ({zoneName})</legend>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
            <input
              id="start-date"
              type="date"
              aria-label="Start date"
              {...invalidProps("start")}
              value={start.date}
              onChange={(e) => setStart((s) => ({ ...s, date: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
            <input
              id="start-time"
              type="time"
              aria-label="Start time"
              {...invalidProps("start")}
              value={start.time}
              onChange={(e) => setStart((s) => ({ ...s, time: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
          </div>
          {fieldError("start")}
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow text-muted">Ends ({zoneName})</legend>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2">
            <input
              id="end-date"
              type="date"
              aria-label="End date"
              {...invalidProps("end")}
              value={end.date}
              onChange={(e) => setEnd((s) => ({ ...s, date: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
            <input
              id="end-time"
              type="time"
              aria-label="End time"
              {...invalidProps("end")}
              value={end.time}
              onChange={(e) => setEnd((s) => ({ ...s, time: e.target.value }))}
              className={`${fieldClass} min-w-0`}
            />
          </div>
          {fieldError("end")}
        </fieldset>
      </div>
      {/* Always there (never display:none), so it's announced when its text changes; out of the
          layout while empty (absolute, so the form's gap doesn't count it). */}
      <p data-zone-note="" aria-live="polite" className="-mt-3 text-sm text-foreground empty:sr-only">
        {zoneNote}
      </p>

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
          {fieldError("ticketingMode")}
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
        <SeatingChoiceField
          value={seatingChoice}
          onChange={setSeatingChoice}
          event={initial}
          admin={isAdmin}
          locked={!isAdmin && initial?.ticketingLocked === true}
          legendClassName={SECTION_TITLE}
        />
      )}

      {ticketingMode === "sheltuh" && (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={SECTION_TITLE}>Ticket types</h2>
          <button
            id="add-ticket-type"
            type="button"
            onClick={() => setTicketTypes((prev) => [...prev, newTicketType()])}
            aria-describedby={errors.ticketTypes ? errorId("ticketTypes") : undefined}
            className="btn btn-outline min-h-11"
          >
            Add ticket type
          </button>
        </div>
        {payoutsNeeded && <PayoutsNeededNotice />}
        {errors.ticketTypes && (
          <p id="ticketTypes-error" className="text-sm text-danger">
            {errors.ticketTypes}
          </p>
        )}

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
                    {...invalidProps(`ticket-${index}-name`)}
                    className={fieldClass}
                  />
                  {fieldError(`ticket-${index}-name`)}
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
                    {...invalidProps(`ticket-${index}-price`)}
                    className={fieldClass}
                  />
                  {fieldError(`ticket-${index}-price`)}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`ticket-${index}-fee-policy`} className="eyebrow text-muted">
                    Who pays the booking fee?
                  </label>
                  <select
                    id={`ticket-${index}-fee-policy`}
                    value={ticket.feePolicy}
                    onChange={(e) => updateTicket(index, { feePolicy: e.target.value as TicketTypeInput["feePolicy"] })}
                    aria-describedby={`ticket-${index}-fee-help`}
                    className={fieldClass}
                  >
                    <option value="buyer-pays">Buyer pays</option>
                    <option value="organiser-absorbs">Organiser absorbs</option>
                  </select>
                  <FeePolicyHelp id={`ticket-${index}-fee-help`} priceCents={ticket.priceCents} isAdmin={isAdmin} />
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
                    {...invalidProps(`ticket-${index}-qty`)}
                    className={fieldClass}
                  />
                  {fieldError(`ticket-${index}-qty`)}
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

      {ticketingMode === "sheltuh" && (
        <RefundPolicyField
          policy={refundPolicy}
          onPolicyChange={(policy) => {
            setRefundPolicy(policy);
            clearRefundErrors();
          }}
          days={refundDays}
          onDaysChange={(days) => {
            setRefundDays(days);
            clearRefundErrors();
          }}
          policyError={errors.refundPolicy}
          daysError={errors.refundDays}
          savedTerms={savedRecord ?? initial}
          startsAt={startInstant(start, timeZone)}
          timeZone={timeZone}
          admin={isAdmin}
          checkedRef={refundChoiceRef}
          daysRef={refundDaysRef}
          legendClassName={SECTION_TITLE}
        />
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

      {payoutsError ? (
        <PayoutsSubmitError id="submit-payouts-error" ref={payoutsErrorRef} message={payoutsError} />
      ) : (
        payoutsNeeded && initial && <PayoutsSubmitHint id="submit-payouts-hint" />
      )}

      {/* Always rendered (never display:none), so it's announced when its text changes. */}
      <p role="status" className="text-sm text-foreground empty:sr-only">
        {status}
      </p>

      <div className="flex flex-wrap gap-3">
        {/* busy, not disabled: the button keeps focus while it works (a disabled one drops it to the page). */}
        <Button
          ref={saveRef}
          type="submit"
          variant="solid"
          busy={saving}
          className="min-h-11 w-fit"
        >
          {saving ? "Saving…" : saveLabel(isAdmin, Boolean(initial), Boolean(createdId), reservedSeating)}
        </Button>
        {initial && !isAdmin && (
          <Button
            variant="outline"
            onClick={handleSubmitForReview}
            // Pressing it during a save is fine: it waits for that save's clip upload.
            busy={submitting}
            // Kept usable while payouts are needed (the refusal is shown, with the fix): this says why first.
            aria-describedby={submitDescription}
            className="min-h-11 w-fit"
          >
            {submitting ? "Submitting…" : "Submit for review"}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The save button's words. Saving a new event with reserved seating goes on to
 * its seat map, and says so.
 */
function saveLabel(isAdmin: boolean, existing: boolean, created: boolean, reserved: boolean): string {
  const toSeats = reserved && !existing;
  if (isAdmin) {
    if (existing) return "Save changes";
    if (toSeats) return created ? "Save and set up seats" : "Create event and set up seats";
    return created ? "Save changes" : "Create event";
  }
  return toSeats ? "Save draft and set up seats" : "Save draft";
}

/**
 * What each booking-fee choice means for this ticket, in plain words, under
 * "Who pays the booking fee?". Amounts come from lib/fees.ts.
 */
function FeePolicyHelp({ id, priceCents, isAdmin }: { id: string; priceCents: number; isAdmin: boolean }) {
  const you = isAdmin ? "the organiser receives" : "you receive";
  if (priceCents <= 0) {
    return (
      <p id={id} className="text-xs text-muted">
        Free tickets have no booking fee, so this choice doesn&rsquo;t apply.
      </p>
    );
  }
  const fee = calculateBookingFeeCents(priceCents);
  const price = formatAud(priceCents);
  return (
    <div id={id} className="flex flex-col gap-1 text-xs text-muted">
      <p>Sheltüh&rsquo;s booking fee is {describeBookingFee()}: {formatAud(fee)} on this ticket.</p>
      <p>
        <span className="font-semibold text-foreground">Buyer pays:</span> the fee is added on top. The buyer pays{" "}
        {formatAud(priceCents + fee)} and {you} the full {price}.
      </p>
      <p>
        <span className="font-semibold text-foreground">Organiser absorbs:</span> the buyer pays just {price} and the fee
        comes out of it, so {you} {formatAud(Math.max(priceCents - fee, 0))}. Handy for keeping a round price.
      </p>
      <p>Card processing costs are covered by Sheltüh either way.</p>
    </div>
  );
}
