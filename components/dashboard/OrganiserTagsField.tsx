"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import InlineReauth, { signedInAgainMessage } from "@/components/auth/InlineReauth";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import FilterChip, { CHIP_SIZING } from "@/components/ui/FilterChip";
import { ApiError } from "@/lib/api/client";
import {
  cleanCustomTag,
  CUSTOM_TAG_MAX_LENGTH,
  CUSTOM_TAG_MIN_LENGTH,
  customTagKey,
  isTagLabel,
  MAX_CUSTOM_TAGS,
  MAX_PROFILE_TAGS,
  ORGANISER_TAGS,
  parseCustomTag,
  TAG_SET_ERRORS,
  inTagOrder,
  tagsForEventCategories,
  type OrganiserTag,
} from "@/lib/api/organiser-tags";
import { setOrganiserTags } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";

/** One own-word input: `touched` once it's been left, so "too short" waits until then. */
interface OwnWord {
  key: number;
  value: string;
  touched: boolean;
}

const AT_LIMIT = `That’s ${MAX_PROFILE_TAGS}. Unselect one to choose another.`;
/** How long the status line stays empty before a repeated message, so it's announced again. */
const REANNOUNCE_DELAY_MS = 100;

const ownWordId = (i: number) => `tag-own-${i}`;

/**
 * The message for own word `i` as the organiser types, in the API's own
 * words: parseCustomTag's, then a repeat of an earlier own word or a list
 * label. Blank is no error (a blank row is dropped on Save). Too short waits
 * until the field has been left, so the first keystroke isn't scolded.
 */
export function ownWordError(words: readonly Pick<OwnWord, "value" | "touched">[], i: number): string | null {
  const value = cleanCustomTag(words[i].value);
  if (!value) return null;
  const tooShortOnly = Array.from(value).length < CUSTOM_TAG_MIN_LENGTH && /^[\p{L}\p{Nd}]+$/u.test(value);
  if (tooShortOnly && !words[i].touched) return null;
  const parsed = parseCustomTag(words[i].value);
  if (!parsed.ok) return parsed.error;
  const key = customTagKey(parsed.value);
  const earlier = words.slice(0, i).some((w) => {
    const other = parseCustomTag(w.value);
    return other.ok && customTagKey(other.value) === key;
  });
  if (earlier) return TAG_SET_ERRORS.duplicate;
  if (isTagLabel(parsed.value)) return TAG_SET_ERRORS.isLabel;
  return null;
}

/**
 * An approved organiser's profile categories (docs/design/organiser-profile.md
 * §5.9): up to 5 chips on their public profile, from the list of 18 and up to
 * 2 in their own words, each own word checked as they type with the API's
 * own rules (lib/api/organiser-tags.ts). Saved with its own button (PUT
 * /organisers/me/tags), straight away, no review. Until they've chosen, it
 * starts from what their profile already shows: their reviewed event
 * categories, mapped to the list.
 */
export default function OrganiserTagsField({ organiser }: { organiser: OrganiserRecord }) {
  const { owner, otherAccount, getOwnerToken } = useAccountOwner();
  const [chosen, setChosen] = useState(organiser.profileTags != null);
  const [selected, setSelected] = useState<OrganiserTag[]>(
    () => organiser.profileTags ?? tagsForEventCategories(organiser.categories),
  );
  // Saved words are keyed by their place (there are at most MAX_CUSTOM_TAGS); rows added later count on from there.
  const [words, setWords] = useState<OwnWord[]>(() =>
    (organiser.customTags ?? []).map((value, i) => ({ key: i, value, touched: true })),
  );
  const nextKey = useRef(MAX_CUSTOM_TAGS);
  // The API's field errors from the last save: `profileTags`, `customTags` and `customTags.<i>` (rows, as sent).
  const [serverErrors, setServerErrors] = useState<{ list?: string; own?: string; rows: Record<number, string> }>({ rows: {} });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingFocus = useRef<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = statusTimer;
    return () => clearTimeout(timer.current);
  }, []);

  // After a render that adds a row or shows errors, move focus where it was asked to go.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  const filledWords = words.filter((w) => cleanCustomTag(w.value));
  const count = selected.length + filledWords.length;
  const atLimit = count >= MAX_PROFILE_TAGS;
  // Only by typing into a row added earlier: the list and "Add" stop at the limit.
  const tooMany = count > MAX_PROFILE_TAGS;

  function showStatus(message: string | null) {
    clearTimeout(statusTimer.current);
    setStatus(message);
  }

  /** Empties the status line, then fills it a moment later, so the same message twice is heard twice. */
  function announce(message: string) {
    showStatus(null);
    statusTimer.current = setTimeout(() => setStatus(message), REANNOUNCE_DELAY_MS);
  }

  function edited() {
    showStatus(null);
    setSubmitError(null);
  }

  function toggle(tag: OrganiserTag) {
    if (selected.includes(tag)) {
      setSelected(selected.filter((t) => t !== tag));
    } else if (atLimit) {
      announce(AT_LIMIT);
      return;
    } else {
      setSelected(inTagOrder([...selected, tag]));
    }
    setServerErrors((prev) => ({ ...prev, list: undefined }));
    edited();
  }

  function changeWord(i: number, value: string) {
    setWords(words.map((w, j) => (j === i ? { ...w, value } : w)));
    setServerErrors((prev) => {
      const rows = { ...prev.rows };
      delete rows[i];
      return { ...prev, own: undefined, rows };
    });
    edited();
  }

  function addWord() {
    if (atLimit || words.length >= MAX_CUSTOM_TAGS) return;
    pendingFocus.current = ownWordId(words.length);
    setWords([...words, { key: nextKey.current++, value: "", touched: false }]);
    edited();
  }

  function removeWord(i: number) {
    setWords(words.filter((_, j) => j !== i));
    setServerErrors({ ...serverErrors, own: undefined, rows: {} });
    edited();
    // "Add your own word" is always back after a removal (fewer than 2 rows).
    pendingFocus.current = "tags-own-add";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showStatus(null);
    setSubmitError(null);
    setSessionExpired(false);

    // Every row counts as left now, so "too short" shows too.
    const checked = words.map((w) => ({ ...w, touched: true }));
    setWords(checked);
    const firstInvalid = checked.findIndex((_, i) => ownWordError(checked, i));
    if (firstInvalid !== -1) {
      pendingFocus.current = ownWordId(firstInvalid);
      setSubmitError("Please fix the highlighted fields.");
      return;
    }
    if (tooMany) {
      // Already shown under the own words as they typed; said again now, and focus goes to the first own word.
      setSubmitError(TAG_SET_ERRORS.tooMany);
      pendingFocus.current = ownWordId(0);
      return;
    }

    if (otherAccount) {
      setSessionExpired(true);
      setSubmitError(new SessionExpiredError().message);
      return;
    }

    // Blank rows are dropped, not an error. Which row each sent word came from, for the API's errors.
    const sentRows = checked.flatMap((w, i) => (cleanCustomTag(w.value) ? [i] : []));
    setSaving(true);
    try {
      const record = await setOrganiserTags(
        { profileTags: selected, customTags: sentRows.map((i) => cleanCustomTag(checked[i].value)) },
        getOwnerToken,
      );
      // What was stored: list order, cleaned own words.
      setSelected(record.profileTags ?? []);
      setWords((record.customTags ?? []).map((value) => ({ key: nextKey.current++, value, touched: true })));
      setServerErrors({ rows: {} });
      setChosen(true);
      showStatus("Categories saved. They’re on your public profile now.");
    } catch (err) {
      // Nothing chosen or typed is cleared on a failure.
      if (err instanceof SessionExpiredError) {
        setSessionExpired(true);
        setSubmitError(err.message);
        return;
      }
      if (err instanceof ApiError && err.status === 400 && err.fieldErrors) {
        const fields = err.fieldErrors;
        const rows: Record<number, string> = {};
        sentRows.forEach((row, sent) => {
          const message = fields[`customTags.${sent}`];
          if (message) rows[row] = message;
        });
        setServerErrors({ list: fields.profileTags, own: fields.customTags, rows });
        const firstRow = Object.keys(rows).map(Number).sort((a, b) => a - b)[0];
        pendingFocus.current = fields.profileTags
          ? `tag-chip-${selected[0] ?? ORGANISER_TAGS[0].value}`
          : firstRow !== undefined
            ? ownWordId(firstRow)
            : fields.customTags && words.length > 0
              ? ownWordId(0)
              : null;
        setSubmitError(err.message);
        return;
      }
      setSubmitError(err instanceof Error ? err.message : "Couldn’t save your categories.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset
        id="categories"
        className="flex min-w-0 flex-col gap-4 border-t border-foreground pt-5"
        aria-describedby="tags-note tags-count"
      >
        <legend className="font-heading text-xl leading-6">Categories</legend>
        <p id="tags-note" className="text-sm text-muted">
          Up to {MAX_PROFILE_TAGS}, shown on your profile under your name. Choose from the list, and add up to{" "}
          {MAX_CUSTOM_TAGS} in your own words.
        </p>
        <div className="flex flex-col gap-1">
          <p id="tags-count" className="text-sm tabular-nums">
            {count} of {MAX_PROFILE_TAGS} chosen
          </p>
          {!chosen && (
            <p className="text-sm text-muted">
              We&rsquo;ve started you with your event categories. Save to keep them, or change them.
            </p>
          )}
        </div>

        <div
          role="group"
          aria-labelledby="tags-list-label"
          aria-describedby={serverErrors.list ? "tags-list-error" : undefined}
          className="flex flex-col gap-2"
        >
          <p id="tags-list-label" className="eyebrow text-muted">
            From the list
          </p>
          <div className="flex flex-wrap gap-2">
            {ORGANISER_TAGS.map(({ value, label }) => {
              const pressed = selected.includes(value);
              if (!pressed && atLimit) {
                // Still focusable and announced as unavailable; pressing it says why.
                return (
                  <button
                    key={value}
                    id={`tag-chip-${value}`}
                    type="button"
                    aria-pressed={false}
                    aria-disabled="true"
                    onClick={() => toggle(value)}
                    className={`label-button inline-flex ${CHIP_SIZING.wrap} cursor-not-allowed items-center gap-2 rounded-control border-control border-surface-border bg-background px-4 text-disabled`}
                  >
                    {label}
                  </button>
                );
              }
              return (
                <FilterChip key={value} id={`tag-chip-${value}`} pressed={pressed} wrap onClick={() => toggle(value)}>
                  {label}
                </FilterChip>
              );
            })}
          </div>
          {serverErrors.list && (
            <p id="tags-list-error" className="text-sm text-danger">
              {serverErrors.list}
            </p>
          )}
        </div>

        <div
          role="group"
          aria-labelledby="tags-own-label"
          aria-describedby={[
            "tags-own-hint",
            serverErrors.own && "tags-own-error",
            tooMany && "tags-too-many",
          ]
            .filter(Boolean)
            .join(" ")}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <p id="tags-own-label" className="eyebrow text-muted">
              In your own words (optional)
            </p>
            <p id="tags-own-hint" className="text-xs text-muted">
              {CUSTOM_TAG_MIN_LENGTH} to {CUSTOM_TAG_MAX_LENGTH} characters: letters, numbers, spaces, &amp; &rsquo; and
              -. No links, @, #, emoji or claims like &ldquo;official&rdquo;.
            </p>
          </div>
          {words.map((word, i) => {
            const id = ownWordId(i);
            const error = ownWordError(words, i) ?? serverErrors.rows[i] ?? null;
            const length = Array.from(cleanCustomTag(word.value)).length;
            return (
              <div key={word.key} className="flex flex-col gap-1">
                <label htmlFor={id} className="text-sm font-medium text-foreground">
                  Own word {i + 1}
                </label>
                {/* Remove goes under the input when there isn't room beside it (large text). */}
                <div className="flex flex-wrap items-start gap-2">
                  <input
                    id={id}
                    type="text"
                    autoComplete="off"
                    value={word.value}
                    onChange={(e) => changeWord(i, e.target.value)}
                    onBlur={() => setWords((prev) => prev.map((w, j) => (j === i ? { ...w, touched: true } : w)))}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={[`${id}-count`, error && `${id}-error`].filter(Boolean).join(" ")}
                    className={`${fieldClass} min-h-12 max-w-xs min-w-0 flex-1 basis-48 sm:min-h-12`}
                  />
                  <Button
                    variant="outline"
                    size="md"
                    aria-label={`Remove own word ${i + 1}`}
                    onClick={() => removeWord(i)}
                    className="shrink-0"
                  >
                    Remove
                  </Button>
                </div>
                <p id={`${id}-count`} className="text-xs text-muted tabular-nums">
                  {length} / {CUSTOM_TAG_MAX_LENGTH}
                </p>
                {error && (
                  <p id={`${id}-error`} className="text-sm text-danger">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          {words.length < MAX_CUSTOM_TAGS && (
            <div className="flex flex-col items-start gap-1">
              <Button
                id="tags-own-add"
                variant="outline"
                size="md"
                aria-disabled={atLimit ? true : undefined}
                aria-describedby={atLimit ? "tags-own-add-note" : undefined}
                onClick={addWord}
              >
                Add your own word
              </Button>
              {atLimit && (
                <p id="tags-own-add-note" className="text-xs text-muted">
                  Unselect one from the list to add your own word.
                </p>
              )}
            </div>
          )}
          {serverErrors.own && (
            <p id="tags-own-error" className="text-sm text-danger">
              {serverErrors.own}
            </p>
          )}
          {/* Always in the page, so it's announced as the count goes over; empty, it takes no room. */}
          <p id="tags-too-many" aria-live="polite" className="text-sm text-danger empty:sr-only">
            {tooMany ? TAG_SET_ERRORS.tooMany : ""}
          </p>
        </div>

        {submitError && sessionExpired && (
          <div role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
            <p>{submitError}</p>
            <InlineReauth
              expectedAccount={owner}
              onSignedIn={() => {
                setSessionExpired(false);
                setSubmitError(null);
                showStatus(signedInAgainMessage("save"));
                saveRef.current?.focus();
              }}
            />
          </div>
        )}
        {submitError && !sessionExpired && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}

        {/* Always in the page, so a save, or the limit, is announced when it changes. Empty, it's collapsed. */}
        <p role="status" className="text-sm text-foreground empty:sr-only">
          {status}
        </p>

        <Button ref={saveRef} type="submit" size="lg" busy={saving} className="w-fit">
          {saving ? "Saving…" : "Save categories"}
        </Button>
      </fieldset>
    </form>
  );
}
