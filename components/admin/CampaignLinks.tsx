"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { adminListEvents, adminListOrganisers } from "@/lib/api/admin";
import type { GetToken } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";
import {
  buildCampaignLink,
  campaignValue,
  MEDIUM_SUGGESTIONS,
  SOURCE_SUGGESTIONS,
} from "@/lib/campaign-links";
import { siteOrigin } from "@/lib/share-metadata";
import CampaignQr from "./CampaignQr";

type DestinationKind = "home" | "map" | "event" | "organiser";

const DESTINATIONS: { value: DestinationKind; label: string }[] = [
  { value: "home", label: "Home page" },
  { value: "map", label: "Nearby" },
  { value: "event", label: "An event" },
  { value: "organiser", label: "An organiser’s page" },
];

/** Wait this long after the last keystroke before searching. */
export const CAMPAIGN_SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

const inputClass = "border border-foreground bg-transparent px-3 py-2 text-foreground";
const labelClass = "text-sm font-medium text-foreground";

interface Choice {
  /** The path the link goes to. */
  path: string;
  label: string;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; choices: Choice[] };

/** Published events (by title or slug) or approved organisers matching `needle`, as the choices for a link. */
async function search(kind: "event" | "organiser", needle: string, getToken: GetToken): Promise<Choice[]> {
  if (kind === "event") {
    const page = await adminListEvents({ status: "published", q: needle || undefined, limit: SEARCH_LIMIT, upcoming: true }, getToken);
    return page.items.map((event) => ({ path: `/events/${encodeURIComponent(event.slug)}`, label: `${event.title} (${event.slug})` }));
  }
  const page = await adminListOrganisers({ status: "approved", q: needle || undefined, limit: SEARCH_LIMIT }, getToken);
  return page.items.map((organiser) => ({ path: `/organisers/${encodeURIComponent(organiser.organiserId)}`, label: organiser.displayName }));
}

/** Finds an event or an organiser to link to; says when it is loading, found nothing or failed. */
function DestinationSearch({
  kind,
  getToken,
  value,
  onChange,
}: {
  kind: "event" | "organiser";
  getToken: GetToken;
  /** The choice made so far: it stays an option (and keeps driving the link) when a new search doesn't find it. */
  value: Choice | null;
  onChange: (choice: Choice) => void;
}) {
  const id = useId();
  const [needle, setNeedle] = useState("");
  const [result, setResult] = useState<{ key: string; state: SearchState } | null>(null);
  const key = `${kind}:${needle.trim()}`;
  const state: SearchState = result?.key === key ? result.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        search(kind, needle.trim(), getToken).then(
          (choices) => {
            if (!cancelled) setResult({ key, state: { status: "ready", choices } });
          },
          (err: unknown) => {
            if (!cancelled) {
              setResult({
                key,
                state: { status: "error", message: err instanceof Error && err.message ? err.message : "Couldn’t search. Try again." },
              });
            }
          },
        );
      },
      needle.trim() ? CAMPAIGN_SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, needle, key, getToken]);

  const noun = kind === "event" ? "event" : "organiser";
  const choices = state.status === "ready" ? state.choices : [];
  // The picked choice stays selectable while it isn't among the found ones (a new search, or one still loading);
  // the count below is of what was found only.
  const options = value && !choices.some((choice) => choice.path === value.path) ? [value, ...choices] : choices;
  let status = "";
  if (state.status === "loading") status = `Searching ${noun}s…`;
  else if (state.status === "ready") status = choices.length === 0 ? `No ${noun}s match.` : `${choices.length} ${choices.length === 1 ? noun : `${noun}s`} found.`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-search`} className={labelClass}>
          Search {noun}s
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
        {state.status === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-choice`} className={labelClass}>
          {kind === "event" ? "Event" : "Organiser"}
        </label>
        <select
          id={`${id}-choice`}
          value={value?.path ?? ""}
          onChange={(e) => {
            const chosen = options.find((choice) => choice.path === e.target.value);
            if (chosen) onChange(chosen);
          }}
          disabled={options.length === 0}
          className={inputClass}
        >
          <option value="" disabled={value !== null}>
            {options.length === 0 ? `No ${noun} to choose` : `Choose an ${noun}`}
          </option>
          {options.map((choice) => (
            <option key={choice.path} value={choice.path}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A labelled text field with suggestions (anything can still be typed). */
function Field({
  label,
  hint,
  value,
  onChange,
  suggestions,
  required = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: readonly string[];
  required?: boolean;
}) {
  const id = useId();
  const saved = campaignValue(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={labelClass}>
        {label}
        {required ? "" : " (optional)"}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={suggestions ? `${id}-list` : undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        maxLength={80}
        className={inputClass}
      />
      {suggestions && (
        <datalist id={`${id}-list`}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      <p id={`${id}-hint`} className="text-sm text-muted">
        {hint}
        {value.trim() && saved !== value.trim() ? ` Goes in the link as “${saved || "…"}”.` : ""}
      </p>
    </div>
  );
}

/**
 * /admin/campaign-links: builds a page address with UTM parameters for a
 * post, bio link, newsletter or poster, with Copy and a QR code. All in the
 * browser: nothing is stored or sent. The link counts in usage analytics under
 * its source, medium and campaign (docs/architecture.md, "Marketing analytics").
 */
export default function CampaignLinks() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [kind, setKind] = useState<DestinationKind>("home");
  const [picked, setPicked] = useState<Choice | null>(null);
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  // The copy's result is for the link that was copied: it isn't shown once the link has changed.
  const [copyResult, setCopyResult] = useState<{ link: string; state: "copied" | "failed" } | null>(null);
  const kindId = useId();
  const linkId = useId();

  // On the page's own origin (the live site), unless NEXT_PUBLIC_SITE_URL says otherwise.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    const own = window.location.origin;
    // Deferred, so the effect body itself never calls setState (as other pages in this app do).
    queueMicrotask(() => setOrigin(siteOrigin() ?? own));
  }, []);

  const path = kind === "home" ? "/" : kind === "map" ? "/map" : (picked?.path ?? "");
  const link = origin ? buildCampaignLink({ origin, path, source, medium, campaign, content }) : null;
  const copied = copyResult && copyResult.link === link ? copyResult.state : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyResult({ link, state: "copied" });
    } catch {
      setCopyResult({ link, state: "failed" });
    }
  }

  function changeKind(next: DestinationKind) {
    setKind(next);
    setPicked(null);
    setCopyResult(null);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <label htmlFor={kindId} className={labelClass}>
          Where should it go?
        </label>
        <select id={kindId} value={kind} onChange={(e) => changeKind(e.target.value as DestinationKind)} className={inputClass}>
          {DESTINATIONS.map((destination) => (
            <option key={destination.value} value={destination.value}>
              {destination.label}
            </option>
          ))}
        </select>
      </div>

      {(kind === "event" || kind === "organiser") && (
        <DestinationSearch key={kind} kind={kind} getToken={getToken} value={picked} onChange={setPicked} />
      )}

      <Field label="Source" required hint="Where the link is posted: instagram, tiktok, email, partner…" value={source} onChange={setSource} suggestions={SOURCE_SUGGESTIONS} />
      <Field label="Medium" required hint="How: bio, story, post, paid, newsletter…" value={medium} onChange={setMedium} suggestions={MEDIUM_SUGGESTIONS} />
      <Field label="Campaign name" required hint="What it’s for, e.g. spring-launch." value={campaign} onChange={setCampaign} />
      <Field label="Content" hint="Tells two links in one campaign apart, e.g. reel-1." value={content} onChange={setContent} />

      <section aria-labelledby={`${linkId}-heading`} className="flex flex-col gap-3 border-t border-foreground pt-6">
        <h2 id={`${linkId}-heading`} className="font-heading text-xl">
          Your link
        </h2>
        {link ? (
          <>
            <label htmlFor={linkId} className="sr-only">
              Campaign link
            </label>
            <textarea id={linkId} readOnly rows={3} value={link} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} field-sizing-content break-all font-mono text-sm`} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={copy}>Copy link</Button>
              <p role="status" className="text-sm text-muted">
                {copied === "copied" ? "Link copied." : ""}
              </p>
              {copied === "failed" && (
                <p role="alert" className="text-sm text-danger">
                  Couldn’t copy. Select the link above and copy it yourself.
                </p>
              )}
            </div>
            <CampaignQr text={link} label="QR code for the campaign link" />
            <p className="text-sm text-muted">Scan it to open the link. Test it before printing.</p>
          </>
        ) : (
          <p className="text-sm text-muted">
            {kind === "event" || kind === "organiser"
              ? "Choose where it goes and fill in the source, medium and campaign name to see your link."
              : "Fill in the source, medium and campaign name to see your link."}
          </p>
        )}
      </section>
    </div>
  );
}
