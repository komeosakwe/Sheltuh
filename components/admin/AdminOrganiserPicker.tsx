"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { adminCreateOrganiser, adminListOrganisers } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminOrganiserRecord } from "@/lib/api/types";
import { EVENT_CATEGORIES, type EventCategory } from "@/lib/types";

export interface PickedOrganiser {
  organiserId: string;
  displayName: string;
  /** No owner account: free Sheltüh tickets or external ticketing only, no check-in. */
  platformManaged: boolean;
}

/** Pages of approved organisers loaded for the picker (20 each). */
const MAX_PAGES = 25;

function toPicked(record: AdminOrganiserRecord): PickedOrganiser {
  return { organiserId: record.organiserId, displayName: record.displayName, platformManaged: !record.ownerUserId };
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
 * /api/admin/organisers, with the organiser application's fields).
 */
export default function AdminOrganiserPicker({ getToken, value, onChange, error }: Props) {
  const [organisers, setOrganisers] = useState<PickedOrganiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all: PickedOrganiser[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const result = await adminListOrganisers("approved", getToken, cursor);
          all.push(...result.items.map(toPicked));
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        if (!cancelled) setOrganisers(all.sort((a, b) => a.displayName.localeCompare(b.displayName)));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load organisers.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  function handleCreated(record: AdminOrganiserRecord) {
    const picked = toPicked(record);
    setOrganisers((prev) => [...prev, picked].sort((a, b) => a.displayName.localeCompare(b.displayName)));
    onChange(picked);
    setCreating(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="organiserId" className="text-sm font-medium text-foreground">
          Organiser
        </label>
        <select
          id="organiserId"
          value={value?.organiserId ?? ""}
          disabled={loading}
          onChange={(e) => {
            const picked = organisers.find((o) => o.organiserId === e.target.value);
            if (picked) onChange(picked);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "organiserId-error" : undefined}
          className="border border-foreground bg-transparent px-3 py-2 text-foreground"
        >
          <option value="" disabled>
            {loading ? "Loading organisers…" : "Choose an organiser"}
          </option>
          {organisers.map((o) => (
            <option key={o.organiserId} value={o.organiserId}>
              {o.platformManaged ? `${o.displayName} (platform-managed)` : o.displayName}
            </option>
          ))}
        </select>
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
        tickets here or link to another site, and there&rsquo;s no check-in. It&rsquo;s approved straight away and
        its profile is public.
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
