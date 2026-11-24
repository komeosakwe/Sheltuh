import Link from "next/link";
import type { ReactNode } from "react";
import { shownCount } from "@/components/account/useAccountNav";
import type { DashArea } from "./DashFrame";

/** One place in a sidebar's nav. */
export interface DashNavItem {
  key: string;
  label: string;
  href: string;
  /**
   * The place you're in: true or "page" on its own page (aria-current="page"), "true" on a page
   * inside it (an event's editor is in Events).
   */
  current: boolean | "page" | "true";
  /** Shown in a pill after the label; null or unset: no pill. */
  count?: number | null;
  /** The count is unread messages: the orange pill. */
  alert?: boolean;
  /** Read after the label by screen readers, with its separator: ", 3 unread". */
  countText?: string;
}

export function ariaCurrent(current: DashNavItem["current"]): "page" | "true" | undefined {
  if (current === true || current === "page") return "page";
  return current === "true" ? "true" : undefined;
}

/** The sidebar column: 264 wide, 64 above, 32 at the sides, 40 below, its parts 12px apart and centred. */
export const SIDEBAR_COLUMN = "w-66 shrink-0 flex-col items-center gap-3 px-8 pt-16 pb-10";

/**
 * The sidebar's contents (Latte's "User / Sidebar" and "Org / Sidebar", both 264px on ink): the
 * 112px round photo or logo, the name (Label/Button, white), a line under it (IBM Plex Mono
 * 12/16, text/secondary: "@handle · 3 upcoming", "Organiser"), the places, and "→ Log out" at the
 * bottom (orange in the customer frames, white in the organiser's). Not an icon sidebar: each
 * place is an 8px dot and its label (Label/Button), 48px tall, radius 16; the current one is
 * filled surface/muted (#1f1f1f on ink), its label and dot orange, with aria-current. Counts are
 * Label/Tag pills: grey, or orange with a black number for unread messages. No hover is drawn:
 * hover and keyboard focus fill the row as the current one is filled, and focus also has the
 * global ring. Drawn by DashSidebar on a desktop and by the organiser's nav drawer below 1024px.
 */
export function DashSidebarBody({
  area,
  avatar,
  name,
  meta,
  navLabel,
  items,
  onLogOut,
  logOutTone,
  onNavigate,
}: {
  area: DashArea;
  avatar: ReactNode;
  /** Unset: no name line (signed out). */
  name?: string | null;
  meta?: string | null;
  navLabel: string;
  items: DashNavItem[];
  /** Unset: no Log out (signed out). */
  onLogOut?: () => void;
  logOutTone: "signal" | "plain";
  /** Called when a place is chosen (the drawer closes). */
  onNavigate?: () => void;
}) {
  return (
    <>
      {avatar}
      {name && <p className="label-button w-full truncate text-center">{name}</p>}
      {name && meta && <p className="w-full truncate text-center font-mono text-xs leading-4 text-muted">{meta}</p>}
      <div aria-hidden="true" className="h-8 shrink-0" />
      <nav aria-label={navLabel} className="w-full">
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const on = ariaCurrent(item.current) !== undefined;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={ariaCurrent(item.current)}
                  onClick={onNavigate}
                  {...{ [`data-${area}-nav`]: item.key }}
                  className={`label-button flex min-h-12 items-center gap-3 rounded-card px-4 py-3 hover:bg-surface focus-visible:bg-surface motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
                    on ? "bg-surface text-signal" : "text-foreground"
                  }`}
                >
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${on ? "bg-signal" : "bg-foreground"}`} />
                  {/* The count's words sit in the label's box, so the link is named "Saved, 12 events". */}
                  <span className="min-w-0 flex-1 truncate">
                    {item.label}
                    {item.countText && <span className="sr-only">{item.countText}</span>}
                  </span>
                  {item.count != null && (
                    <span
                      aria-hidden="true"
                      {...{ [`data-${area}-count`]: "" }}
                      className={`label-tag shrink-0 rounded-badge px-2 py-1 tabular-nums ${
                        item.alert ? "bg-signal text-signal-foreground" : "bg-surface-border text-foreground"
                      }`}
                    >
                      {shownCount(item.count)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div aria-hidden="true" className="flex-1" />
      {onLogOut && (
        <button
          type="button"
          onClick={onLogOut}
          className={`label-button flex min-h-12 w-full items-center gap-2 rounded-card px-4 py-3 text-left hover:bg-surface focus-visible:bg-surface ${
            logOutTone === "signal" ? "text-signal" : "text-foreground"
          }`}
        >
          <span aria-hidden="true">→</span>
          Log out
        </button>
      )}
    </>
  );
}

/**
 * The desktop sidebar (from 1024px): DashSidebarBody in a black (ink) column beside the page, so
 * it's black in both themes. `label` names it as a landmark.
 */
export default function DashSidebar({
  label,
  ...body
}: Parameters<typeof DashSidebarBody>[0] & { label: string }) {
  return (
    <aside
      data-surface="ink"
      {...{ [`data-${body.area}-sidebar`]: "" }}
      aria-label={label}
      className={`hidden lg:flex ${SIDEBAR_COLUMN}`}
    >
      <DashSidebarBody {...body} />
    </aside>
  );
}
