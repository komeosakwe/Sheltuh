"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import InlineReauth, { signedInAgainMessage } from "@/components/auth/InlineReauth";
import { ApiError, type GetToken } from "@/lib/api/client";
import AdminOrganiserPicker, { type PickedOrganiser } from "@/components/admin/AdminOrganiserPicker";
import EventClipField, { clipStatusText } from "@/components/dashboard/EventClipField";
import EventImageField from "@/components/dashboard/EventImageField";
import { PayoutsNeededNotice, PayoutsPublishError, PayoutsPublishHint } from "@/components/dashboard/PayoutsRequired";
import RefundPolicyField from "@/components/dashboard/RefundPolicyField";
import {
  locationChange,
  PLACES_UNAVAILABLE_NOTE,
  useVenueLocation,
  VENUE_LOCATION_ERROR_ID,
  VENUE_LOCATION_ID,
  VenuePinStep,
  VenuePlaceLink,
  venuePlaceKey,
} from "@/components/dashboard/VenueLocationField";
import type { PickedPlace } from "@/components/dashboard/VenuePlaceSearch";
import VenueSuburbField, {
  hasZoneChoice,
  useVenuePlace,
  VENUE_SUBURB_ID,
  VENUE_TIME_ZONE_ID,
  VenueZoneField,
  venueZoneName,
  type VenuePlaceState,
  type VenueResolution,
} from "@/components/dashboard/VenueSuburbField";
import SeatingChoiceField, {
  initialSeatingChoice,
  seatMapHref,
  type SeatingChoice,
} from "@/components/dashboard/SeatingChoice";
import { ClipSyncError, useEventClip, type ClipRoutes } from "@/components/dashboard/useEventClip";
import EditorBar from "@/components/dashboard/editor/EditorBar";
import EditorCard from "@/components/dashboard/editor/EditorCard";
import EditorShell from "@/components/dashboard/editor/EditorShell";
import EditorSummary from "@/components/dashboard/editor/EditorSummary";
import ErrorSummary, { type ErrorSummaryItem } from "@/components/dashboard/editor/ErrorSummary";
import { PreviewButton, PreviewPanel } from "@/components/dashboard/editor/PreviewPanel";
import PublishChecklist, { type ChecklistRow } from "@/components/dashboard/editor/PublishChecklist";
import {
  PUBLISH_REFUSAL_ID,
  PublishConfirm,
  PublishOutcomeView,
  type PublishOutcome,
} from "@/components/dashboard/editor/PublishParts";
import StepNav from "@/components/dashboard/editor/StepNav";
import TicketTypeFields from "@/components/dashboard/editor/TicketTypeFields";
import {
  cleanTicketType,
  draftErrors,
  EDITOR_STEPS,
  errorFieldLabel,
  LOCATION_REQUIRED_TEXT,
  PLATFORM_FREE_ONLY,
  stepComplete,
  stepOfControlId,
  stepOfErrorKey,
  type EditorStep,
} from "@/components/dashboard/editor/draft";
import { draftToPreviewEvent } from "@/components/dashboard/editor/preview-event";
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
  publishConflictCode,
  publishEvent,
  updateEventDraft,
  uploadEventImage,
  type EventInput,
} from "@/lib/api/events";
import { isPlacesUnavailableError } from "@/lib/api/places";
import type { AdminEventRecord, EventRecord, PublishEventConflictCode, TicketTypeInput } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { eventClipsEnabled } from "@/lib/clips-flag";
import { eventZone, formatEventDateShort, formatEventTime, toDateTimeInputParts } from "@/lib/format";
import { assignPoster } from "@/lib/live/assign-poster";
import {
  apiReviewReason,
  organiserEventStatus,
  PUBLISH_REVIEW_REASON_TEXT,
  publishReviewReason,
  removedBefore,
} from "@/lib/organiser-events";
import { formatFeedPriceParts } from "@/lib/pricing";
import { DEFAULT_REFUND_POLICY, type RefundPolicy } from "@/lib/refund-policy";
import { sellsPaidTicketsOnSheltuh, type TicketingMode } from "@/lib/ticketing";
import { placeName, placeQuery } from "@/lib/place";
import { localToUtcIso, PLATFORM_TIME_ZONE, zoneShortLabel } from "@/lib/time-zones";
import { EVENT_CATEGORIES, type Coordinates } from "@/lib/types";

/** A card's title when it's a child's legend (seating, refunds, where tickets are sold): the same as EditorCard's h3. */
const SECTION_TITLE = "font-heading text-lg leading-6 text-foreground";

interface OrganiserProps {
  getToken: GetToken;
  mode?: "organiser";
  initial?: EventRecord;
  onSaved: (record: EventRecord) => void;
  /**
   * The organiser's `payoutsEnabled` (GET /api/organisers/me); undefined while
   * it isn't known. False: an event with paid Sheltüh tickets says, by its
   * tickets and its Publish button, that payouts come first (publishing it is
   * refused with 409 `payouts_required`). Saving a draft never needs them.
   */
  payoutsEnabled?: boolean;
  /**
   * The organiser's `eventReviewRequired` (an admin checks their events before
   * they go live): Publish… says it will be sent for review, and why.
   */
  eventReviewRequired?: boolean;
  /** The organiser's name, for the preview of a new event (a saved event's own is used otherwise). */
  organiserName?: string;
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
  eventReviewRequired?: never;
  organiserName?: never;
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

/** The publish response: the event, and (from the API, when it says) why it was sent to review (apiReviewReason). */
type PublishedEvent = EventRecord & { reviewReason?: string };

/** A publish refused with a 409 other than payouts (those have their own message and link). */
type PublishRefusalCode = Exclude<PublishEventConflictCode, "payouts_required">;

/** What each refusal says by the buttons; `reload`: it offers to reload the page. */
const PUBLISH_REFUSALS: Record<PublishRefusalCode, { text: string; reload: boolean }> = {
  event_ended: { text: "This event has already ended, so it can\u2019t be published.", reload: false },
  in_review: {
    text: "This event is already waiting for review (it was sent from another tab or device). Reload the page to see it.",
    reload: true,
  },
  event_changed: {
    text: "This event\u2019s ticket link changed while it was being published. Your changes were saved: reload the page, then publish again.",
    reload: true,
  },
  location_required: { text: LOCATION_REQUIRED_TEXT, reload: false },
};

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
    ["location", VENUE_LOCATION_ID],
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
  // The venue's location (owner decisions A-D1 to A-D3): a Google place and the organiser's confirmed
  // pin, or a pin alone. The pin counts for the suburb it was confirmed in.
  const placeKey = venue.place ? venuePlaceKey(venue.place.name, venue.place.state) : null;
  const venueLocation = useVenueLocation(initial, placeKey);
  // What picking a Google place last filled each field with: a field is filled again only while it's
  // empty or still says that, never over what the organiser typed.
  const [prefilled, setPrefilled] = useState<{ venueName?: string; venueAddress?: string; suburb?: string }>({});
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
  // Organisers: the event as last saved here (or published from here, which the page may not have
  // passed back yet), else as loaded.
  const current = savedRecord ?? initial;
  const locked = !isAdmin && current ? current.status === "pending_review" || current.status === "published" : false;
  // Organisers: publishing it goes to review (and the button says "Send for review", with no
  // question first) when Sheltüh rejected or unpublished it last; for the other known reasons the
  // question says so (lib/organiser-events.ts).
  const eventReviewRequired = props.mode === "admin" ? undefined : props.eventReviewRequired;
  const removed = !isAdmin && current ? removedBefore(current) : null;
  const reviewReason = !isAdmin && current ? publishReviewReason(current, eventReviewRequired) : null;

  // Which of the three views of the one form is showing (docs/design/event-editor.md §5.0): view state
  // only. All three panels stay mounted (the others `hidden`), so nothing typed is lost between steps.
  const [step, setStep] = useState<EditorStep>(1);
  // When the editor was opened: what the checklist's "already ended" is judged against (advisory; the server decides).
  const [openedAt] = useState(() => Date.now());
  // The photo as it'd show (an object URL from EventImageField), for the summary and the live preview.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // A clip step that failed is explained, and focused, by the clip field (Event page step): show that step
  // in the same render, so the field is on screen when its focus effect runs.
  const [seenClipFailures, setSeenClipFailures] = useState(0);
  if (clip.state.failures !== seenClipFailures) {
    setSeenClipFailures(clip.state.failures);
    setStep(1);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Organisers' publish: the question is open; what it did; why it was refused (focused once shown).
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const [publishRefusal, setPublishRefusal] = useState<PublishRefusalCode | null>(null);
  const publishOpenRef = useRef<HTMLButtonElement>(null);
  const publishCancelRef = useRef<HTMLButtonElement>(null);
  const publishRefusalRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const focusPublish = useRef<"cancel" | "open" | "refusal" | "outcome" | null>(null);
  // The polite line by the buttons: said after signing in again in a recovery.
  const [status, setStatus] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // Organisers: the publish was refused because payouts aren't set up (the server's message), and
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
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  // Set by a step change the person made (Next, Back, the rail): the new step's title is scrolled to and focused.
  const focusStepTitle = useRef(false);

  useEffect(() => {
    if (focusStepTitle.current && stepTitleRef.current) {
      focusStepTitle.current = false;
      stepTitleRef.current.focus({ preventScroll: true });
      // The page's scroll-padding clears the header. (Not in every browser engine or test DOM: then focus alone.)
      stepTitleRef.current.scrollIntoView?.({ block: "start" });
    }
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
    if (focusPublish.current) {
      const target = {
        cancel: publishCancelRef,
        open: publishOpenRef,
        refusal: publishRefusalRef,
        outcome: outcomeRef,
      }[focusPublish.current].current;
      if (target) {
        focusPublish.current = null;
        target.focus();
      }
    }
    if (!focusPayoutsError.current || !payoutsErrorRef.current) return;
    focusPayoutsError.current = false;
    payoutsErrorRef.current.focus();
  });

  // Paid Sheltüh tickets, as on screen, while the organiser's payouts are off: publishing will be refused.
  const payoutsNeeded =
    props.mode !== "admin" &&
    (props.payoutsEnabled === false || payoutsRefused) &&
    sellsPaidTicketsOnSheltuh({ ticketingMode, ticketTypes });
  const submitDescription = payoutsError ? "publish-payouts-error" : payoutsNeeded ? "publish-payouts-hint" : undefined;

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
    // An organiser's publish, refused until their payouts are set up: the reason and the way to fix it, focused.
    // (An admin's save gets it as any other refusal: fieldErrors.ticketTypes by the tickets, the message below.)
    if (!isAdmin && isPayoutsRequiredError(err)) {
      setPayoutsRefused(true);
      setPayoutsError(err.message);
      focusPayoutsError.current = true;
      setStep(3);
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
      setStep(2);
      return;
    }
    // Google couldn't check the place being saved: the pin alone instead (a confirmed pin is kept).
    if (isPlacesUnavailableError(err)) venueLocation.manual(PLACES_UNAVAILABLE_NOTE);
    if (err instanceof ApiError && err.fieldErrors) {
      const fieldErrors = err.fieldErrors;
      setErrors((prev) => ({ ...prev, ...fieldErrors }));
      // Focus the first field the API refused, as for this form's own errors (its message is read with it).
      focusFirstInvalid(fieldErrors);
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

  /** Focus goes to this control once it's on screen: its step is shown first (the others' panels are hidden). */
  function focusControl(id: string) {
    focusInvalidId.current = id;
    setStep(stepOfControlId(id));
  }

  /** The first field that needs fixing among `fieldErrors` (this form's order), focused on its step. */
  function focusFirstInvalid(fieldErrors: Record<string, string>) {
    const first = invalidControlIds(fieldErrors, ticketTypes.length, start, end, zoneChoice)[0] ?? null;
    focusInvalidId.current = first;
    if (first) setStep(stepOfControlId(first));
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
    const external = ticketingMode === "external";
    const nextErrors = draftErrors({
      title,
      description,
      venueName,
      venueAddress,
      place,
      start,
      end,
      organiserMissing: isAdmin && !initial && !createdId && !organiser,
      isAdmin,
      platformManaged,
      ticketingMode,
      externalTicketUrl,
      ticketTypes,
      refundPolicy,
      refundDays: refundDaysNumber(),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Focus the first field to fix (its error is read with it), and say how many there are by the buttons.
      focusFirstInvalid(nextErrors);
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
      ticketTypes: external ? [] : ticketTypes.map(cleanTicketType),
    };
    // The venue's location: only when it differs from what's saved (absent keeps it; null removes it).
    const location = locationChange(venueLocation.input, current?.location);
    if (location !== undefined) input.location = location;
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
      // The clip field says what's missing (the Event page step); a form error is shown and focused on its own step.
      if (input) setStep(1);
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

  /**
   * A Google place was picked (VenuePlaceSearch): linked, and its name,
   * street address and suburb fill the fields that are empty or still say
   * what an earlier pick filled in (never over what the organiser typed).
   */
  function handlePicked({ suggestion, details }: PickedPlace) {
    const fillable = (value: string, last: string | undefined) => !value.trim() || value === last;
    const next = { ...prefilled };
    if (suggestion.primaryText && fillable(venueName, prefilled.venueName)) {
      setVenueName(suggestion.primaryText);
      next.venueName = suggestion.primaryText;
    }
    if (details.streetAddress && fillable(venueAddress, prefilled.venueAddress)) {
      setVenueAddress(details.streetAddress);
      next.venueAddress = details.streetAddress;
    }
    if (details.locality) {
      // As the suburb's own suggestions say it ("Fitzroy, VIC"); checked against the suburb table as typed text is.
      const suburb = details.state ? placeName(details.locality, details.state) : details.locality;
      if (fillable(venue.suburb, prefilled.suburb)) {
        venue.requestTable();
        venue.setSuburb(suburb);
        next.suburb = suburb;
      }
    }
    setPrefilled(next);
    venueLocation.link(details.placeId, [suggestion.primaryText, suggestion.secondaryText].filter(Boolean).join(", "));
    clearErrors("venueName", "venueAddress", "suburb", "state", "timeZone", "location");
  }

  /**
   * Organisers: publishing needs the venue's confirmed pin (the API refuses
   * it with `location_required` otherwise). Without one, it's said by the
   * venue and by the buttons, and the venue section is focused; true then.
   */
  function refuseWithoutPin(): boolean {
    // As the save will leave it: the pin on screen, or (searching after Change) the one kept.
    if (venueLocation.hasPin) return false;
    setPublishConfirm(false);
    setPublishRefusal("location_required");
    setErrors((prev) => ({ ...prev, location: LOCATION_REQUIRED_TEXT }));
    focusControl(VENUE_LOCATION_ID);
    return true;
  }

  /** Opens the question before publishing, Cancel focused (the safe choice). */
  function openPublishConfirm() {
    setSubmitError(null);
    setPublishRefusal(null);
    setStatus(null);
    if (refuseWithoutPin()) return;
    focusPublish.current = "cancel";
    setPublishConfirm(true);
  }

  /** Closes the question, back to Publish…. */
  function closePublishConfirm() {
    focusPublish.current = "open";
    setPublishConfirm(false);
  }

  /**
   * Organisers: publishes the event (POST /api/events/{id}/publish), which
   * puts it live now or sends it for review (lib/organiser-events.ts says
   * why), after saving what's on screen. What happened replaces the form.
   */
  async function handlePublish() {
    // Organisers only: an admin publishes from the save itself.
    if (!initial || props.mode === "admin") return;
    setSubmitError(null);
    setPayoutsError(null);
    setPublishRefusal(null);
    showSessionExpired(false);
    setStatus(null);
    if (refuseWithoutPin()) return;
    // Publish what's on screen, not the last save: unsaved edits are saved
    // first, and nothing is published if they don't validate.
    setSubmitting(true);
    const input = buildInput(await venue.resolveForSave());
    if (input && refuseOtherAccount()) {
      setSubmitting(false);
      return;
    }
    const clipReady = await clip.validate();
    if (!input || !clipReady) {
      // The first field to fix is focused: the question is over.
      if (!input) setPublishConfirm(false);
      else setStep(1);
      setSubmitting(false);
      return;
    }
    try {
      const saved = await updateEventDraft(initial.eventId, input, saveToken);
      const withImage = await syncImage(saved, uploadEventImage, deleteEventImage);
      // Waits for a clip upload a save already started, and never publishes without the clip.
      setSavedRecord(await syncClip(withImage, ORGANISER_CLIP_ROUTES, props.onSaved));
      const record: PublishedEvent = await publishEvent(initial.eventId, saveToken);
      setPublishConfirm(false);
      if (record.status === "published") setOutcome({ kind: "published", slug: record.slug });
      else if (record.status === "pending_review") {
        // The API's reason when it gives one (only it knows some), else what this page can tell.
        const reason = apiReviewReason(record.reviewReason, record) ?? publishReviewReason(record, eventReviewRequired);
        setOutcome({ kind: "review", reason });
      }
      focusPublish.current = "outcome";
      setSavedRecord(record);
      props.onSaved(record);
    } catch (err) {
      const code = publishConflictCode(err);
      if (code && code !== "payouts_required") {
        // It can't be published as it is: say why, focused, with the way on.
        setPublishConfirm(false);
        setPublishRefusal(code);
        if (code === "location_required") {
          // Said by the venue too, which is focused: that's where it's fixed.
          setErrors((prev) => ({ ...prev, location: LOCATION_REQUIRED_TEXT }));
          focusControl(VENUE_LOCATION_ID);
        } else {
          focusPublish.current = "refusal";
          setStep(3);
        }
      } else {
        if (isPayoutsRequiredError(err)) setPublishConfirm(false);
        handleError(err, "Couldn't publish this event.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---- What the shell shows (docs/design/event-editor.md §5): all of it read from the form as it stands.
  const eventTimeZone = eventZone(timeZone);
  const startIso = startInstant(start, timeZone);
  const whenText = startIso ? `${formatEventDateShort(startIso, eventTimeZone)}, ${formatEventTime(startIso, eventTimeZone)}` : "";
  const organiserName = current?.organiserName ?? organiser?.displayName ?? props.organiserName ?? "Your organiser";
  const savedAt = current
    ? new Date(current.updatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    : undefined;
  const poster = assignPoster(current?.slug ?? current?.eventId ?? createdId ?? "new");
  const hasPhoto = Boolean(imageFile) || Boolean(savedRecord?.imageUrl && !imageRemoved);
  const hasClip = clip.state.file !== null || Boolean(clip.state.saved && !clip.state.removed);
  const clipBusy = clip.state.phase.kind === "uploading" || clip.state.phase.kind === "checking";
  const external = ticketingMode === "external";
  const { event: previewEvent, missing: previewMissing } = draftToPreviewEvent({
    eventId: current?.eventId ?? createdId ?? undefined,
    slug: current?.slug,
    title,
    description,
    category,
    suburb: venue.place ? venue.place.name : venue.suburb.trim(),
    state: venue.place?.state ?? initial?.state,
    timeZone,
    venueName,
    venueAddress,
    pin: venueLocation.pin,
    placeId: venueLocation.linked?.placeId,
    start,
    end,
    organiserName,
    organiserLogoThumbUrl: current?.organiserLogoThumbUrl,
    imageUrl: photoUrl ?? undefined,
    ticketTypes,
    ticketingMode,
    externalTicketUrl: isAdmin ? externalTicketUrl.trim() : initial?.externalTicketUrl,
    externalFree,
    externalProvider: initial?.externalProvider,
    refundPolicy,
    refundDays: refundDaysNumber(),
  });
  const price = ticketingMode === "sheltuh" ? formatFeedPriceParts(previewEvent) : null;
  const eventStatus = current ? organiserEventStatus(current) : null;
  const summary = (
    <EditorSummary
      title={title}
      when={whenText}
      status={{ label: eventStatus?.label ?? "Draft", tone: eventStatus?.tone ?? "neutral", notSaved: !current && !createdId }}
      lastSaved={savedAt}
      poster={poster}
      imageUrl={photoUrl ?? undefined}
      price={price}
      organiser={isAdmin ? `${current?.organiserName ?? organiser?.displayName ?? ""}${platformManaged ? " (platform-managed)" : ""}`.trim() || undefined : undefined}
    />
  );
  const previewButton = <PreviewButton event={previewEvent} missing={previewMissing} />;
  const previewPanel = <PreviewPanel event={previewEvent} missing={previewMissing} />;

  if (locked) {
    const published = current?.status === "published";
    return (
      <EditorShell
        rail={
          <>
            {summary}
            <div className="flex justify-end xl:hidden">{previewButton}</div>
          </>
        }
        preview={previewPanel}
      >
        {outcome ? (
          <PublishOutcomeView outcome={outcome} ref={outcomeRef} />
        ) : (
          // The same words as the dashboard's status badge (lib/organiser-events.ts).
          <div className="rounded-card border border-foreground bg-card p-4 text-foreground sm:p-5">
            <h2 className="font-heading text-xl">{published ? "Published" : "Waiting for review"}</h2>
            <p className="mt-2 text-sm text-muted">
              This event can&rsquo;t be edited while it&rsquo;s {published ? "published" : "waiting for review"}.
            </p>
          </div>
        )}
      </EditorShell>
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

  /** Shows a step the person chose (the rail, Next, Back): its title is scrolled to and focused, which announces it. */
  function goToStep(next: EditorStep) {
    if (next === step) return;
    focusStepTitle.current = true;
    setStep(next);
  }

  /** Focuses a control, on its own step: at once when that's showing, else once the step has rendered. */
  function jumpTo(id: string) {
    const target = stepOfControlId(id);
    if (target === step) document.getElementById(id)?.focus();
    else focusControl(id);
  }

  /** Where each field's error is focused (the summary and the checklist jump there). */
  function controlForKey(key: string): string | null {
    switch (key) {
      case "suburb":
      case "state":
        return VENUE_SUBURB_ID;
      case "timeZone":
        return zoneChoice ? VENUE_TIME_ZONE_ID : VENUE_SUBURB_ID;
      case "location":
        return VENUE_LOCATION_ID;
      case "start":
        return start.date ? "start-time" : "start-date";
      case "end":
        return end.date ? "end-time" : "end-date";
      case "ticketTypes":
        return "add-ticket-type";
      case "image":
        return "event-image";
      case "reason":
        return "admin-reason";
      case "refundPolicy":
        return null;
      default:
        return key;
    }
  }

  /** The summary's link for a field: its step is shown, then the control (the refund policy's is its chosen option). */
  function jumpToKey(key: string) {
    if (key === "refundPolicy") {
      if (step === 2) refundChoiceRef.current?.focus();
      else {
        focusRefund.current = "choice";
        setStep(2);
      }
      return;
    }
    const id = controlForKey(key);
    if (id) jumpTo(id);
  }

  const errorItems: ErrorSummaryItem[] = orderedErrorKeys(Object.keys(errors), ticketTypes.length).map((key) => {
    const known = errorFieldLabel(key) !== key;
    return {
      key,
      step: stepOfErrorKey(key),
      field: errorFieldLabel(key),
      message: errors[key],
      jump: known ? () => jumpToKey(key) : undefined,
    };
  });
  const errorCounts: Record<EditorStep, number> = { 1: 0, 2: 0, 3: 0 };
  for (const key of Object.keys(errors)) errorCounts[stepOfErrorKey(key)] += 1;

  // The form as it stands, checked the way a save checks it (never shown or enforced from here).
  const problems = draftErrors({
    title,
    description,
    venueName,
    venueAddress,
    place: venue.place
      ? { kind: "found", place: venue.place }
      : venue.suburb.trim()
        ? { kind: "unknown", message: "Check the suburb." }
        : { kind: "empty" },
    start,
    end,
    organiserMissing: false,
    isAdmin,
    platformManaged,
    ticketingMode,
    externalTicketUrl,
    ticketTypes,
    refundPolicy,
    refundDays: refundDaysNumber(),
  });
  const complete = { 1: stepComplete(1, problems, venueLocation.hasPin), 2: stepComplete(2, problems, venueLocation.hasPin) };

  const ticketProblem = Object.keys(problems).find((key) => key === "ticketTypes" || key.startsWith("ticket-") || key === "externalTicketUrl");
  // Typed but not publishable: it has ended already (the server refuses `event_ended`), or ends before it starts.
  const endIso = startInstant(end, timeZone);
  const dateProblem =
    startIso && endIso && Date.parse(endIso) <= Date.parse(startIso)
      ? "The end must be after the start"
      : endIso && Date.parse(endIso) <= openedAt
        ? "This event has already ended"
        : null;
  const check = (key: string, name: string, ok: boolean, todo: string, goTo?: { label: string; id: string }): ChecklistRow => ({
    key,
    name,
    state: ok ? "done" : "todo",
    word: ok ? "Done" : todo,
    goTo: ok ? undefined : goTo,
  });
  const checklist: ChecklistRow[] = [
    check("title", "Title", !problems.title, "Add a title", { label: "Title", id: "title" }),
    check("description", "Description", !problems.description, "Add a description", { label: "Description", id: "description" }),
    check(
      "venue",
      "Venue",
      !problems.venueName && !problems.venueAddress && !problems.suburb,
      "Add the venue",
      { label: "Venue", id: problems.venueName ? "venueName" : problems.venueAddress ? "venueAddress" : VENUE_SUBURB_ID },
    ),
    check("pin", "Venue pin", venueLocation.hasPin, LOCATION_REQUIRED_TEXT, { label: "Venue", id: VENUE_LOCATION_ID }),
    check("when", "Date and time", !problems.start && !problems.end && !dateProblem, dateProblem ?? "Add the start and end", {
      label: "Date and time",
      id: problems.start ? (start.date ? "start-time" : "start-date") : end.date ? "end-time" : "end-date",
    }),
    check("tickets", "Tickets", !ticketProblem, (ticketProblem && problems[ticketProblem]) || "Fix the ticket types", {
      label: "Tickets",
      id: ticketProblem ? (controlForKey(ticketProblem) ?? "add-ticket-type") : "add-ticket-type",
    }),
    ...(external
      ? []
      : [
          check("refund", "Refund policy", !problems.refundDays, "Enter the refund days", { label: "Tickets", id: "refundDays" }),
        ]),
    {
      key: "photo",
      name: "Photo",
      state: hasPhoto ? "done" : "optional",
      word: hasPhoto ? "Added" : "Optional: generated artwork is used",
    },
    ...(clipField
      ? [{ key: "clip", name: "Clip", state: hasClip ? "done" : "optional", word: hasClip ? "Added" : "Optional" } satisfies ChecklistRow]
      : []),
    ...(!isAdmin && sellsPaidTicketsOnSheltuh({ ticketingMode, ticketTypes })
      ? [
          {
            key: "payouts",
            name: "Payouts",
            state: payoutsNeeded ? "todo" : "done",
            word: payoutsNeeded ? "Set up payouts before publishing" : "Done",
            payoutsLink: payoutsNeeded,
          } satisfies ChecklistRow,
        ]
      : []),
  ];

  const stepIntro: Record<EditorStep, { title: string; intro: ReactNode }> = {
    1: { title: "Build your event page", intro: "Add a photo, the details, the venue and the date. You can save a draft at any point." },
    2: {
      title: "Add tickets",
      intro: "Set prices, seating and refunds. Buyers see the all-inclusive price, with the booking fee included.",
    },
    3: {
      title: "Publish",
      intro: isAdmin ? (
        "Save your changes. Tick Publish when saved to put it live."
      ) : removed ? (
        "It goes to Sheltüh for review again before it goes live."
      ) : (
        <>
          Check the list, then publish. Your changes are saved first.
          {reviewReason && <span className="mt-1 block">{PUBLISH_REVIEW_REASON_TEXT[reviewReason]}</span>}
        </>
      ),
    },
  };

  return (
    <form ref={formRef} onSubmit={handleSave} className="flex flex-col gap-6" noValidate>
      <EditorShell
        rail={
          <>
            {summary}
            <div className="flex items-center justify-between gap-3 xl:hidden">
              <p aria-hidden="true" className="meta text-muted lg:hidden">
                Step {step} of {EDITOR_STEPS.length}
              </p>
              <div className="ml-auto">{previewButton}</div>
            </div>
            <StepNav current={step} onSelect={goToStep} complete={complete} errorCounts={errorCounts} admin={isAdmin} />
          </>
        }
        preview={previewPanel}
      >
        {/* Notices: on every step, at the top, so they're seen wherever the person has scrolled. */}
        {(initial?.status === "rejected" || initial?.status === "draft") && initial.rejectionReason && (
          // Sheltüh's note: why it was rejected, or why it was taken off the site (a draft with a note).
          <div className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
            <p className="font-medium">
              {initial.status === "rejected"
                ? "Not approved — reviewer note:"
                : isAdmin
                  ? "Unpublished — note to the organiser:"
                  : "Taken off Sheltüh — note from Sheltüh:"}
            </p>
            <p className="mt-1 break-words whitespace-pre-wrap text-muted">{initial.rejectionReason}</p>
            {!isAdmin && (
              <p className="mt-2 text-muted">
                When you send it for review again, a person at Sheltüh checks it before it goes live.
              </p>
            )}
          </div>
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

        {/* The clip is sent while the person is on another step: its progress is said here too (the clip field, with Cancel, is on the Event page step). */}
        {clipField && (
          <div className="flex flex-wrap items-center gap-x-3 empty:hidden">
            <p aria-live="polite" className="text-sm text-foreground empty:hidden">
              {step !== 1 && clipBusy ? clipStatusText(clip.state) : ""}
            </p>
            {step !== 1 && clipBusy && (
              <button type="button" onClick={() => goToStep(1)} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
                Show clip
              </button>
            )}
          </div>
        )}

        <ErrorSummary items={errorItems} />

        <StepPanel n={1} step={step} title={stepIntro[1].title} intro={stepIntro[1].intro} titleRef={stepTitleRef}>
          {isAdmin && ((!initial && !createdId) || initial?.status === "published" || platformManaged) && (
            <EditorCard title="Event organiser" helper={!initial && !createdId ? "Whose event this is." : undefined}>
              {!initial && !createdId && (
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
              {initial?.status === "published" && (
                <p className="text-sm text-muted">This event is published: your changes go live as soon as you save.</p>
              )}
              {platformManaged && (
                <p className="border-l-2 border-foreground px-4 py-2 text-sm text-muted">
                  {PLATFORM_FREE_ONLY} Its events are checked in at the door by an admin.
                </p>
              )}
            </EditorCard>
          )}

          <EditorCard
            title="Photo and clip"
            helper={
              clipField
                ? "Add a photo to lead your event page. A short clip is optional: it plays when someone taps the photo."
                : "Add a photo to lead your event page."
            }
          >
            <EventImageField
              getToken={getToken}
              existingUrl={savedRecord?.imageUrl}
              pending={imageFile}
              onPendingChange={setImageFile}
              removed={imageRemoved}
              onRemovedChange={setImageRemoved}
              error={errors.image}
              poster={poster}
              title={title}
              onPreviewUrl={setPhotoUrl}
            />
            {clipField && (
              <div className="border-t border-surface-border pt-5">
                <EventClipField
                  draft={clip}
                  getToken={getToken}
                  canUpload={clipsOn}
                  eventId={initial?.eventId ?? createdId ?? undefined}
                  // The upload stopped: save again (the event, then the clip).
                  onRetry={() => formRef.current?.requestSubmit()}
                />
              </div>
            )}
          </EditorCard>

          <EditorCard title="Event details" helper="The name and description people see first.">
            <div className="flex flex-col gap-1">
              <label htmlFor="title" className="eyebrow text-muted">
                Title
              </label>
              <input
                id="title"
                value={title}
                {...invalidProps("title")}
                onChange={(e) => setTitle(e.target.value)}
                className={`${fieldClass} font-semibold`}
              />
              {fieldError("title")}
            </div>

            <div className="flex flex-col gap-1 sm:max-w-xs">
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

            <div className="flex flex-col gap-1">
              <label htmlFor="description" className="eyebrow text-muted">
                Description
              </label>
              <textarea
                id="description"
                rows={6}
                value={description}
                {...invalidProps("description")}
                aria-describedby={errors.description ? `description-hint ${errorId("description")}` : "description-hint"}
                onChange={(e) => setDescription(e.target.value)}
                className={fieldClass}
              />
              <p id="description-hint" className="text-xs leading-4 text-muted">
                Shown in About this event.
              </p>
              {fieldError("description")}
            </div>
          </EditorCard>

          <EditorCard
            title="Venue"
            titleId="venue-heading"
            helper="Where guests go. Publishing needs a confirmed pin on the map."
            id={VENUE_LOCATION_ID}
            tabIndex={-1}
            role="group"
            aria-labelledby="venue-heading"
            aria-describedby={errors.location ? VENUE_LOCATION_ERROR_ID : undefined}
            className="outline-offset-4"
          >
            <VenuePlaceLink
              location={venueLocation}
              getToken={saveToken}
              onPicked={handlePicked}
              venueName={venueName}
              venueAddress={venueAddress}
              suburb={venue.place ? placeName(venue.place.name, venue.place.state) : venue.suburb}
              error={errors.location}
            />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                <div className="sm:col-span-2">
                  <VenueZoneField venue={venue} timeZoneError={errors.timeZone} onZoneEdit={() => clearErrors("timeZone")} />
                </div>
              )}
            </div>
            {venueLocation.mode !== "search" && (
              // A stacking context of its own: Leaflet's panes (z-index up to 700) can't paint over the sticky bar.
              <div className="isolate">
                <VenuePinStep
                  location={venueLocation}
                  suburbCentre={suburbCentre(venue)}
                  waiting={Boolean(venue.suburb.trim()) && venue.loading}
                  suburbTyped={Boolean(venue.suburb.trim())}
                  suburbLabel={venue.place ? placeName(venue.place.name, venue.place.state) : ""}
                  onEdit={() => clearErrors("location")}
                />
              </div>
            )}
          </EditorCard>

          <EditorCard title="Date and time" helper="Times are in the venue's time zone, taken from its suburb.">
            <div className="flex flex-col gap-5">
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="eyebrow mb-2 text-muted">Starts ({zoneName})</legend>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2 sm:grid-cols-2 sm:gap-3">
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
                <legend className="eyebrow mb-2 text-muted">Ends ({zoneName})</legend>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,8rem)] gap-2 sm:grid-cols-2 sm:gap-3">
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
                layout while empty (sr-only), so the card's gap doesn't count it. */}
            <p data-zone-note="" aria-live="polite" className="-mt-1 text-sm text-foreground empty:sr-only">
              {zoneNote}
            </p>
          </EditorCard>
        </StepPanel>

        <StepPanel n={2} step={step} title={stepIntro[2].title} intro={stepIntro[2].intro} titleRef={stepTitleRef}>
          {isAdmin && (
            <EditorCard titled={false}>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-3">
                  <h3 className={SECTION_TITLE}>Where are tickets sold?</h3>
                </legend>
                <div className="flex flex-wrap gap-x-5 text-sm text-foreground">
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="ticketingMode"
                      value="sheltuh"
                      checked={ticketingMode === "sheltuh"}
                      onChange={() => setTicketingMode("sheltuh")}
                    />
                    On Sheltüh
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
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
                    <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={externalFree} onChange={(e) => setExternalFree(e.target.checked)} />
                      Entry is free
                    </label>
                  </>
                )}
              </fieldset>
            </EditorCard>
          )}

          {!isAdmin && external && (
            <EditorCard title="Tickets">
              <div className="text-sm text-foreground">
                <p className="font-medium">Tickets are sold on {initial?.externalProvider ?? "the organiser’s site"}</p>
                <p className="mt-1 break-all text-muted">{initial?.externalTicketUrl}</p>
              </div>
            </EditorCard>
          )}

          {ticketingMode === "sheltuh" && (
            <EditorCard titled={false}>
              <SeatingChoiceField
                value={seatingChoice}
                onChange={setSeatingChoice}
                event={initial}
                admin={isAdmin}
                locked={!isAdmin && initial?.ticketingLocked === true}
                legendClassName={SECTION_TITLE}
              />
            </EditorCard>
          )}

          {ticketingMode === "sheltuh" && (
            <EditorCard
              title="Ticket types"
              action={
                <button
                  id="add-ticket-type"
                  type="button"
                  onClick={() => setTicketTypes((prev) => [...prev, newTicketType()])}
                  aria-describedby={errors.ticketTypes ? errorId("ticketTypes") : undefined}
                  className="btn btn-outline min-h-11 shrink-0"
                >
                  Add ticket type
                </button>
              }
            >
              {payoutsNeeded && <PayoutsNeededNotice />}
              {errors.ticketTypes && (
                <p id="ticketTypes-error" className="text-sm text-danger">
                  {errors.ticketTypes}
                </p>
              )}
              {ticketTypes.map((ticket, index) => (
                <TicketTypeFields
                  key={ticket.id}
                  ticket={ticket}
                  index={index}
                  count={ticketTypes.length}
                  isAdmin={isAdmin}
                  errors={errors}
                  onChange={(patch) => updateTicket(index, patch)}
                  onRemove={() => removeTicket(index)}
                />
              ))}
            </EditorCard>
          )}

          {ticketingMode === "sheltuh" && (
            <EditorCard titled={false}>
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
            </EditorCard>
          )}
        </StepPanel>

        <StepPanel n={3} step={step} title={stepIntro[3].title} intro={stepIntro[3].intro} titleRef={stepTitleRef}>
          <EditorCard title="Before you publish" helper="A checklist of what's left. Publishing is checked again when you do it.">
            <PublishChecklist rows={checklist} onGo={jumpTo} />
            <p className="text-sm text-muted">Some events are checked by Sheltüh before going live.</p>
          </EditorCard>

          {!isAdmin && (
            <EditorCard title="Publish">
              {initial ? (
                <>
                  {payoutsError ? (
                    <PayoutsPublishError id="publish-payouts-error" ref={payoutsErrorRef} message={payoutsError} />
                  ) : (
                    payoutsNeeded && <PayoutsPublishHint id="publish-payouts-hint" />
                  )}

                  {publishRefusal && (
                    // Focused once shown (as the payouts refusal is), which reads it: no role="alert" too.
                    <div
                      ref={publishRefusalRef}
                      id={PUBLISH_REFUSAL_ID}
                      tabIndex={-1}
                      role="group"
                      aria-labelledby={`${PUBLISH_REFUSAL_ID}-message`}
                      className="flex flex-col items-start gap-2 border-l-2 border-danger py-1 pl-4 text-sm text-foreground"
                    >
                      <p id={`${PUBLISH_REFUSAL_ID}-message`}>{PUBLISH_REFUSALS[publishRefusal].text}</p>
                      {PUBLISH_REFUSALS[publishRefusal].reload && (
                        <Button variant="outline" size="sm" className="min-h-11" onClick={() => window.location.reload()}>
                          Reload page
                        </Button>
                      )}
                    </div>
                  )}

                  {!publishConfirm && (
                    <Button
                      ref={publishOpenRef}
                      variant="solid"
                      // Sent for review with no question first when Sheltüh rejected or unpublished it last;
                      // otherwise Publish… asks first (it goes live, and followers are emailed).
                      onClick={removed ? handlePublish : openPublishConfirm}
                      // Pressing it during a save is fine: it waits for that save's clip upload.
                      busy={submitting}
                      // Kept usable while payouts are needed (the refusal is shown, with the fix): this says why first.
                      aria-describedby={submitDescription}
                      className="min-h-11 w-fit"
                    >
                      {removed ? (submitting ? "Sending…" : "Send for review") : "Publish…"}
                    </Button>
                  )}

                  {publishConfirm && (
                    <PublishConfirm
                      reason={reviewReason}
                      busy={submitting}
                      describedBy={submitDescription}
                      cancelRef={publishCancelRef}
                      onConfirm={handlePublish}
                      onCancel={closePublishConfirm}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">Save the draft first. Publishing opens once it is saved.</p>
              )}
            </EditorCard>
          )}

          {isAdmin && (
            <EditorCard title="Save and publish">
              {initial && (
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
              {initial?.status !== "published" && (
                <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                  {initial || createdId ? "Publish when saved" : "Publish straight away"}
                </label>
              )}
            </EditorCard>
          )}
        </StepPanel>
      </EditorShell>

      <EditorBar
        step={step}
        onStep={goToStep}
        saveRef={saveRef}
        saving={saving}
        saveLabel={saveLabel(isAdmin, Boolean(initial), Boolean(createdId), reservedSeating)}
        lastSaved={savedAt}
      />
    </form>
  );
}

/** Orders the keys of an error record as the form is laid out: step 1's fields, then tickets, then the note; the rest last. */
function orderedErrorKeys(keys: string[], ticketCount: number): string[] {
  const order = ["organiserId", "title", "description", "venueName", "venueAddress", "suburb", "state", "timeZone", "location", "start", "end", "image", "externalTicketUrl", "ticketTypes"];
  for (let i = 0; i < ticketCount; i++) order.push(`ticket-${i}-name`, `ticket-${i}-price`, `ticket-${i}-qty`);
  order.push("refundPolicy", "refundDays", "reason");
  const known = order.filter((key) => keys.includes(key));
  return [...known, ...keys.filter((key) => !order.includes(key))];
}

/** The suburb's centre in the ABS table (where the pin map starts without a pin), once the table and the suburb are known. */
function suburbCentre(venue: VenuePlaceState): Coordinates | null {
  if (!venue.location || !venue.place) return null;
  const locality = venue.location.findLocality(placeQuery({ suburb: venue.place.name, state: venue.place.state }));
  return locality ? { lat: locality.lat, lng: locality.lng } : null;
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
 * One step's panel: its title and intro, then its cards. Hidden (never unmounted) unless it's the current
 * step, so what was typed, the pending photo and the clip draft stay while the person moves around.
 */
function StepPanel({
  n,
  step,
  title,
  intro,
  titleRef,
  children,
}: {
  n: EditorStep;
  step: EditorStep;
  title: string;
  intro: ReactNode;
  titleRef: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <div hidden={step !== n} data-step-panel={n} className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-1">
        <h2
          ref={step === n ? titleRef : undefined}
          tabIndex={-1}
          className="display-md outline-offset-2 focus:outline-none!"
        >
          {title}
        </h2>
        <p className="max-w-prose text-sm leading-5 text-muted">{intro}</p>
      </div>
      {children}
    </div>
  );
}
