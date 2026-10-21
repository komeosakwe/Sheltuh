"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { adminCreateOrganiser, adminListOrganisers } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminOrganiserRecord } from "@/lib/api/types";
import { EVENT_CATEGORIES, type EventCategory } from "@/lib/types";

export interface PickedOrganiser {
  organiserId: string;
  displayName: string;
  /**
   * No owner account: free Sheltüh tickets or external ticketing only, and
   * admins run its events' door check-in.
   */
  platformManaged: boolean;
}

/**
 * How many approved organisers the picker shows at once: one page of the
 * list API (its maximum). Typing searches all of them on the server (name,
 * contact email and handles, any case, accents optional), so an organiser
 * past this page is always reachable.
 */
export const ORGANISER_PICKER_PAGE = 50;

/** Wait this long after the last keystroke before searching. */
export const ORGANISER_SEARCH_DEBOUNCE_MS = 250;

function toPicked(record: AdminOrganiserRecord): PickedOrganiser {
  return { organiserId: record.organiserId, displayName: record.displayName, platformManaged: !record.ownerUserId };
}

const byName = (a: PickedOrganiser, b: PickedOrganiser) => a.displayName.localeCompare(b.displayName);

interface Results {
  /** The search these are for ("" for the first page of everyone). */
  query: string;
  organisers: PickedOrganiser[];
  /** More organisers match than are shown. */
  more: boolean;
}

interface Props {
  getToken: GetToken;
  value: PickedOrganiser | null;
  onChange: (organiser: PickedOrganiser) => void;
  error?: string;
}

/**
 * The admin editor's organiser choice for a new event: any approved
 * organiser, or a new platform-managed one created inline (POST
 * /api/admin/organisers, with the organiser application's fields). Shows the
 * first ORGANISER_PICKER_PAGE; typing searches every approved organiser on
 * the server (debounced), and announces how many match.
 */
export default function AdminOrganiserPicker({ getToken, value, onChange, error }: Props) {
  const [results, setResults] = useState<Results | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  // Organisers created here, kept as options whatever the search shows.
  const [created, setCreated] = useState<PickedOrganiser[]>([]);
  const needle = query.trim();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const page = await adminListOrganisers(
          { status: "approved", q: needle || undefined, limit: ORGANISER_PICKER_PAGE },
          getToken,
        );
        if (cancelled) return;
        setResults({ query: needle, organisers: page.items.map(toPicked).sort(byName), more: Boolean(page.nextCursor) });
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load organisers.");
      }
    };
    // The first list loads at once; a search waits for a pause in typing.
    const timer = setTimeout(run, needle ? ORGANISER_SEARCH_DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [needle, getToken]);

  function handleCreated(record: AdminOrganiserRecord) {
    const picked = toPicked(record);
    setCreated((prev) => [...prev, picked]);
    onChange(picked);
    setCreating(false);
  }

  const loading = results === null && !loadError;
  // Results for an older query are kept on screen until the new ones arrive, but not announced.
  const current = results !== null && results.query === needle;
  const shown = results?.organisers ?? [];
  // The chosen organiser (and any created here) stay options while not in the results, so the select never shows a blank choice.
  const extras = [...(value ? [value] : []), ...created].filter(
    (o, i, all) => !shown.some((s) => s.organiserId === o.organiserId) && all.findIndex((x) => x.organiserId === o.organiserId) === i,
  );
  const options = [...extras, ...shown];
  const capNote =
    current && results?.more
      ? needle
        ? `Showing the first ${shown.length} matches — keep typing to narrow them down.`
        : `Showing ${shown.length} organisers — type to search for others.`
      : null;
  const describedBy = [error ? "organiserId-error" : null, capNote ? "organiserId-cap" : null].filter(Boolean).join(" ");

  let status = "";
  if (needle && current) {
    const n = shown.length;
    status =
      n === 0
        ? `No organisers match “${needle}”.`
        : results?.more
          ? `More than ${n} organisers match.`
          : `${n} ${n === 1 ? "organiser matches" : "organisers match"}.`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="organiserId-filter" className="text-sm font-medium text-foreground">
          Search organisers
        </label>
        <input
          id="organiserId-filter"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={keepEnter}
          aria-controls="organiserId"
          aria-describedby="organiserId-filter-hint"
          autoComplete="off"
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />
        <p id="organiserId-filter-hint" className="text-sm text-muted">
          Name, contact email or social handle.
        </p>
        {/* Announced when a search's results arrive; silent until something is typed. */}
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="organiserId" className="text-sm font-medium text-foreground">
          Organiser
        </label>
        <select
          id="organiserId"
          value={value?.organiserId ?? ""}
          disabled={loading}
          onChange={(e) => {
            const picked = options.find((o) => o.organiserId === e.target.value);
            if (picked) onChange(picked);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        >
          <option value="" disabled>
            {loading ? "Loading organisers…" : "Choose an organiser"}
          </option>
          {options.map((o) => (
            <option key={o.organiserId} value={o.organiserId}>
              {o.platformManaged ? `${o.displayName} (platform-managed)` : o.displayName}
            </option>
          ))}
        </select>
        {capNote && (
          <p id="organiserId-cap" className="text-sm text-muted">
            {capNote}
          </p>
        )}
        {error && (
          <p id="organiserId-error" className="text-sm text-danger">
            {error}
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        )}
      </div>
      {creating ? (
        <NewPlatformOrganiser getToken={getToken} onCreated={handleCreated} onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="btn btn-outline btn-sm w-fit">
          Create a platform-managed organiser
        </button>
      )}
    </div>
  );
}

/** Enter in these fields must not submit the event form around them. */
function keepEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

function NewPlatformOrganiser({
  getToken,
  onCreated,
  onCancel,
}: {
  getToken: GetToken;
  onCreated: (record: AdminOrganiserRecord) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [description, setDescription] = useState("");
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setFormError(null);
    setErrors({});
    setSaving(true);
    try {
      const record = await adminCreateOrganiser(
        {
          displayName: displayName.trim(),
          contactEmail: contactEmail.trim(),
          description,
          categories,
          websiteUrl: websiteUrl.trim() || null,
        },
        getToken,
      );
      onCreated(record);
    } catch (err) {
      // The API names fields as the application does; the inputs here carry a prefix.
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [`new-organiser-${k}`, v])));
      }
      setFormError(err instanceof Error ? err.message : "Couldn't create the organiser.");
    } finally {
      setSaving(false);
    }
  }

  const field = (id: string, label: string, input: ReactNode) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {input}
      {errors[id] && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {errors[id]}
        </p>
      )}
    </div>
  );
  const describedBy = (id: string) => (errors[id] ? `${id}-error` : undefined);

  return (
    <div role="group" aria-labelledby="new-organiser-heading" className="flex flex-col gap-4 border border-surface-border p-4">
      <p id="new-organiser-heading" className="font-heading text-lg text-foreground">
        New platform-managed organiser
      </p>
      <p className="text-sm text-muted">
        For events Sheltüh lists on someone&rsquo;s behalf. It has no account, so its events can only have free
        tickets here or link to another site, and Sheltüh admins check tickets in at the door. It&rsquo;s approved
        straight away and its profile is public.
      </p>
      {field(
        "new-organiser-displayName",
        "Name",
        <input
          id="new-organiser-displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={keepEnter}
          aria-describedby={describedBy("new-organiser-displayName")}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />,
      )}
      {field(
        "new-organiser-contactEmail",
        "Contact email",
        <input
          id="new-organiser-contactEmail"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          onKeyDown={keepEnter}
          aria-describedby={describedBy("new-organiser-contactEmail")}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />,
      )}
      {field(
        "new-organiser-description",
        "Description",
        <textarea
          id="new-organiser-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-describedby={describedBy("new-organiser-description")}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />,
      )}
      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy("new-organiser-categories")}>
        <legend className="text-sm font-medium text-foreground">Categories</legend>
        <div className="flex flex-wrap gap-4 text-sm text-foreground">
          {EVENT_CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={categories.includes(c.value)}
                onChange={(e) =>
                  setCategories((prev) => (e.target.checked ? [...prev, c.value] : prev.filter((v) => v !== c.value)))
                }
              />
              {c.label}
            </label>
          ))}
        </div>
        {errors["new-organiser-categories"] && (
          <p id="new-organiser-categories-error" className="text-sm text-danger">
            {errors["new-organiser-categories"]}
          </p>
        )}
      </fieldset>
      {field(
        "new-organiser-websiteUrl",
        "Website (optional)",
        <input
          id="new-organiser-websiteUrl"
          type="url"
          placeholder="https://"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          onKeyDown={keepEnter}
          aria-describedby={describedBy("new-organiser-websiteUrl")}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        />,
      )}
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={handleCreate} disabled={saving} className="btn btn-solid btn-sm">
          {saving ? "Creating…" : "Create organiser"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-outline btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
