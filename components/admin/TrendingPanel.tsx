"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import MessageField from "@/components/messages/MessageField";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { ApiError, type GetToken } from "@/lib/api/client";
import {
  getEventCuration,
  MAX_TRENDING_BOOST,
  MIN_TRENDING_BOOST,
  setEventCuration,
  type CurationLogEntry,
  type EventCuration,
} from "@/lib/api/trending";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";
import AdminSessionExpired from "./AdminSessionExpired";
import { actionErrorText } from "./OrganiserItem";

/** The API's limit for a curation reason (lib/server/handlers/trending.ts). */
export const CURATION_REASON_MAX = 500;

/** The anchor the queue, the hub and /admin/trending link to: /admin/events/{id}/edit#trending. */
export const TRENDING_PANEL_ID = "trending";

/** The boosts offered, in words; an event's current boost is added if it's another value (set before). */
const BOOSTS: { value: number; label: string }[] = [
  { value: 0.5, label: "Half (×0.5)" },
  { value: 0.75, label: "Less (×0.75)" },
  { value: 1, label: "Normal (×1)" },
  { value: 1.25, label: "A little more (×1.25)" },
  { value: 1.5, label: "More (×1.5)" },
  { value: 2, label: "Double (×2)" },
];

function boostLabel(value: number) {
  return BOOSTS.find((b) => b.value === value)?.label ?? `×${value}`;
}

/** One log line: "Boost ×1 → ×1.5; hidden from Trending". */
export function describeCurationChange(entry: CurationLogEntry): string {
  const parts: string[] = [];
  if (entry.changes.boost) parts.push(`Boost ×${entry.changes.boost.old} → ×${entry.changes.boost.new}`);
  if (entry.changes.excluded) {
    parts.push(entry.changes.excluded.new ? "Hidden from Trending" : "Allowed back into Trending");
  }
  return parts.join("; ") || "No change";
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; curation: EventCuration };

type FieldErrors = { boost?: string; excluded?: string; reason?: string };

/**
 * An event's Trending curation, on its admin edit page (id="trending"): a
 * boost (×0.5 to ×2, multiplying its trending score) and "Keep out of
 * Trending", each change with a reason (admins only see it), and the last 20
 * changes. A boost takes effect at the next trending refresh; keeping it out
 * hides it from the public list straight away.
 */
export default function TrendingPanel({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const [attempt, setAttempt] = useState(0);
  const key = `${eventId}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  /** What the last save did, announced. */
  const [saved, setSaved] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Arrived at #trending: focus the heading once the panel has loaded (it isn't there for the browser to scroll to). */
  const jumped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getEventCuration(eventId, getToken).then(
      (curation) => {
        if (!cancelled) setResult({ key, state: { status: "ready", curation } });
      },
      (err: unknown) => {
        if (cancelled) return;
        setResult({
          key,
          state: {
            status: "error",
            message: actionErrorText(err, "Couldn’t load this event’s Trending settings. Try again."),
            sessionExpired: err instanceof SessionExpiredError,
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, key]);

  useEffect(() => {
    if (jumped.current || state.status !== "ready") return;
    jumped.current = true;
    if (window.location.hash === `#${TRENDING_PANEL_ID}`) headingRef.current?.focus();
  }, [state.status]);

  return (
    <section
      id={TRENDING_PANEL_ID}
      aria-labelledby="trending-heading"
      className="flex scroll-mt-24 flex-col gap-4 border-t border-foreground pt-5"
    >
      <div>
        <h2 id="trending-heading" ref={headingRef} tabIndex={-1} className="font-heading text-xl leading-6 outline-offset-2">
          Trending
        </h2>
        <p className="mt-1 text-sm text-muted">
          Boost this event in the home page’s Trending, or keep it out. Boosts apply at the next refresh (a few
          minutes); keeping it out applies straight away.
        </p>
      </div>

      <p role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {saved}
      </p>
      {state.status === "loading" && <LoadingState text="Loading…" />}
      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          {state.sessionExpired ? (
            <AdminSessionExpired then="try again" withForm={false} onSignedIn={() => setAttempt((n) => n + 1)} />
          ) : (
            <Notice tone="danger" role="alert">
              {state.message}
            </Notice>
          )}
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <CurationForm
          eventId={eventId}
          curation={state.curation}
          getToken={getToken}
          onSaved={(curation) => {
            setResult({ key, state: { status: "ready", curation } });
            setSaved(
              `Saved: ${boostLabel(curation.boost)}${curation.excluded ? ", kept out of Trending" : ", allowed in Trending"}.`,
            );
          }}
          onEdit={() => setSaved("")}
        />
      )}
    </section>
  );
}

function CurationForm({
  eventId,
  curation,
  getToken,
  onSaved,
  onEdit,
}: {
  eventId: string;
  curation: EventCuration;
  getToken: GetToken;
  onSaved: (curation: EventCuration) => void;
  /** A save was started: the last "Saved" line no longer applies. */
  onEdit: () => void;
}) {
  const [boost, setBoost] = useState(curation.boost);
  const [excluded, setExcluded] = useState(curation.excluded);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const boosts = BOOSTS.some((b) => b.value === curation.boost)
    ? BOOSTS
    : [...BOOSTS, { value: curation.boost, label: `×${curation.boost} (set before)` }].sort((a, b) => a.value - b.value);
  const changed = boost !== curation.boost || excluded !== curation.excluded;

  function focusField(field: keyof FieldErrors) {
    document.getElementById(`curation-${field}`)?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setExpired(false);
    onEdit();
    if (!changed) {
      setError("Nothing has changed: pick another boost, or change “Keep out of Trending”, first.");
      return;
    }
    const invalid = validateMessage(reason, { label: "Reasons", empty: "Enter a reason.", max: CURATION_REASON_MAX });
    if (invalid) {
      setErrors({ reason: invalid });
      focusField("reason");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const next = await setEventCuration(eventId, { boost, excluded, reason: reason.trim() }, getToken);
      // The form stays (the Save button keeps focus), showing the saved values.
      setBoost(next.boost);
      setExcluded(next.excluded);
      setReason("");
      onSaved(next);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        const fields: FieldErrors = {
          boost: err.fieldErrors.boost,
          excluded: err.fieldErrors.excluded,
          reason: err.fieldErrors.reason,
        };
        setErrors(fields);
        const first = (["boost", "excluded", "reason"] as const).find((f) => fields[f]);
        if (first) focusField(first);
        else setError(err.message);
      } else if (err instanceof SessionExpiredError) {
        setExpired(true);
      } else {
        setError(actionErrorText(err, "Couldn’t save. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Now: <span className="font-semibold">{boostLabel(curation.boost)}</span>
        {curation.excluded ? (
          <>
            {" "}
            &middot; <span className="font-semibold">kept out of Trending</span>
          </>
        ) : null}
        {curation.updatedAt && <span className="text-muted"> &middot; changed {formatDayTime(curation.updatedAt)}</span>}
      </p>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="curation-boost" className="eyebrow text-muted">
            Boost
          </label>
          <select
            id="curation-boost"
            value={String(boost)}
            onChange={(e) => setBoost(Number(e.target.value))}
            aria-invalid={errors.boost ? true : undefined}
            aria-describedby={errors.boost ? "curation-boost-error" : "curation-boost-hint"}
            className={`${fieldClass} sm:max-w-xs`}
          >
            {boosts.map((b) => (
              <option key={b.value} value={String(b.value)}>
                {b.label}
              </option>
            ))}
          </select>
          <p id="curation-boost-hint" className="text-xs text-muted">
            Multiplies its trending score, from ×{MIN_TRENDING_BOOST} to ×{MAX_TRENDING_BOOST}.
          </p>
          {errors.boost && (
            <p id="curation-boost-error" className="text-sm text-danger">
              {errors.boost}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input
              id="curation-excluded"
              type="checkbox"
              checked={excluded}
              onChange={(e) => setExcluded(e.target.checked)}
              aria-invalid={errors.excluded ? true : undefined}
              aria-describedby={errors.excluded ? "curation-excluded-error" : undefined}
              className="size-5"
            />
            Keep out of Trending
          </label>
          {errors.excluded && (
            <p id="curation-excluded-error" className="text-sm text-danger">
              {errors.excluded}
            </p>
          )}
        </div>

        <MessageField
          id="curation-reason"
          label="Reason (admins only)"
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (errors.reason) setErrors((e) => ({ ...e, reason: undefined }));
          }}
          error={errors.reason}
          rows={2}
          max={CURATION_REASON_MAX}
        />

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {expired && <AdminSessionExpired then="save again" onSignedIn={() => setExpired(false)} />}

        <Button type="submit" variant="solid" size="sm" className="min-h-11 w-fit" busy={busy}>
          {busy ? "Saving…" : "Save Trending settings"}
        </Button>
      </form>

      <div>
        <h3 className="eyebrow text-muted">Recent changes</h3>
        {curation.log.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No changes yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {curation.log.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="border-t border-surface-border py-2 text-sm">
                <p>
                  <span className="meta text-muted">{formatDayTime(entry.at)}</span> &middot; {describeCurationChange(entry)}
                </p>
                {entry.reason && <p className="mt-0.5 break-words text-muted">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
