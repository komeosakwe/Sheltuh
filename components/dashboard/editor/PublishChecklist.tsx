import Link from "next/link";
import { PAYOUTS_SETUP_HREF } from "@/components/dashboard/PayoutsRequired";
import { ADD_LOGO_HREF } from "@/lib/organiser-profile";

export type ChecklistState = "done" | "todo" | "optional";

export interface ChecklistRow {
  key: string;
  name: string;
  state: ChecklistState;
  /** The state in words: "Done", "Add a title", "Optional: generated artwork is used". */
  word: string;
  /** For a row that needs attention: where "Go to {goTo}" takes you (`id`: the control; `onGo` switches step and focuses it). */
  goTo?: { label: string; id: string };
  /** The payouts row: a link to set them up instead. */
  payoutsLink?: boolean;
  /** The advisory Logo row: a link to add one on the Profile page. */
  logoLink?: boolean;
}

function Glyph({ state }: { state: ChecklistState }) {
  const common = { "aria-hidden": true, viewBox: "0 0 16 16", className: "mt-0.5 size-4 shrink-0", fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
  if (state === "done")
    return (
      <svg {...common}>
        <path d="M3 8.5l3.5 3.5L13 4.5" />
      </svg>
    );
  if (state === "todo")
    return (
      <svg {...common} className={`${common.className} text-danger`}>
        <path d="M8 2l6.5 11.5h-13z" strokeLinejoin="round" />
        <path d="M8 6.5v3M8 11.5v.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common} className={`${common.className} text-muted`}>
      <path d="M4 8h8" />
    </svg>
  );
}

/**
 * "Before you publish" (docs/design/event-editor.md §5.7): an advisory list of what the event still needs.
 * Derived from the form as it stands; the server (and the save's own checks) stay the authority, and
 * nothing here blocks anything. Each state is a glyph and a word, never colour alone.
 */
export default function PublishChecklist({ rows, onGo }: { rows: readonly ChecklistRow[]; onGo: (id: string) => void }) {
  return (
    <ul data-publish-checklist="" className="flex flex-col">
      {rows.map((row) => {
        const { goTo } = row;
        return (
          <li key={row.key} data-check={row.key} data-state={row.state} className="flex min-h-11 flex-wrap items-start gap-x-3 gap-y-1 py-2">
            <Glyph state={row.state} />
            <span className="text-sm leading-5 font-semibold">{row.name}</span>
            <span className="text-sm leading-5 text-muted">{row.word}</span>
            {goTo && (
              <button
                type="button"
                onClick={() => onGo(goTo.id)}
                aria-label={`Go to ${goTo.label}: ${row.word}`}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 sm:-my-3"
              >
                Go to {goTo.label}
              </button>
            )}
            {row.payoutsLink && (
              <Link
                href={PAYOUTS_SETUP_HREF}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4 sm:-my-3"
              >
                Set up payouts
              </Link>
            )}
            {row.logoLink && (
              <Link
                href={ADD_LOGO_HREF}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4 sm:-my-3"
              >
                Add logo
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
