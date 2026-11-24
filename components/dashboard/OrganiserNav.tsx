"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import DashDrawer from "@/components/dashboard/ui/DashDrawer";
import DashSidebar, { ariaCurrent, DashSidebarBody, SIDEBAR_COLUMN, type DashNavItem } from "@/components/dashboard/ui/DashSidebar";
import {
  CalendarIcon,
  CollapseIcon,
  ExpandIcon,
  LogOutIcon,
  ReceiptIcon,
  UserIcon,
  WalletIcon,
} from "@/components/dashboard/ui/icons";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { ORGANISER_NAV, organiserCurrent, type OrganiserNavIcon } from "@/lib/organiser-nav";
import OrganiserAvatar from "./OrganiserAvatar";

const ICONS: Record<OrganiserNavIcon, ComponentType<{ className?: string }>> = {
  calendar: CalendarIcon,
  receipt: ReceiptIcon,
  wallet: WalletIcon,
  user: UserIcon,
};

/** The landmark around the organiser's identity and places (the sidebar, or the rail). */
const ASIDE_LABEL = "Organiser account";
/** The places' nav, in the sidebar, the rail and the drawer (only one is ever shown). */
const NAV_LABEL = "Organiser";
/**
 * The line under the organiser's name. The frames draw "Organiser · Naarm": organisers have no
 * city on file, so the city is left out until they do (organiser-dashboard plan §2.1).
 */
const ORGANISER_META = "Organiser";

type Organiser = Pick<OrganiserRecord, "displayName" | "logoUrl">;

function useOrganiserNav(pathname: string) {
  const router = useRouter();
  const auth = useAuth();
  const items: (DashNavItem & { icon: OrganiserNavIcon })[] = ORGANISER_NAV.map((link) => ({
    key: link.key,
    label: link.label,
    href: link.href,
    icon: link.icon,
    current: organiserCurrent(link, pathname),
  }));
  function logOut() {
    auth.signOut();
    router.push("/");
  }
  return { items, logOut };
}

/**
 * The organiser's desktop sidebar (Latte's "Org / Sidebar" 466:7547, from 1024px): the shared
 * dashboard sidebar with their logo or initials (112px, orange), their name, "Organiser", the
 * places, and "→ Log out" in white (as the organiser frames draw it).
 */
export function OrganiserSidebar({ organiser, pathname }: { organiser: Organiser; pathname: string }) {
  const { items, logOut } = useOrganiserNav(pathname);
  return (
    <DashSidebar
      area="organiser"
      label={ASIDE_LABEL}
      navLabel={NAV_LABEL}
      avatar={<OrganiserAvatar name={organiser.displayName} logoUrl={organiser.logoUrl} size="sidebar" />}
      name={organiser.displayName}
      meta={ORGANISER_META}
      items={items}
      onLogOut={logOut}
      logOutTone="plain"
    />
  );
}

/** A rail button or link: 48 × 48, radius 8, the icon centred, filled #1f1f1f (surface on ink) under the pointer or focus. */
const RAIL_TARGET =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-control text-foreground hover:bg-surface focus-visible:bg-surface motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out";

/**
 * The organiser's tablet and phone navigation (Latte's "Org / Sidebar · Collapsed" 495:19097 and
 * "Nav expanded" 495:22558 / 495:22467, below 1024px): a 64px black rail down the panel's left
 * with their 40px mark, » (opens the full sidebar as a drawer), a divider, one 48px icon link per
 * place and the Log out icon at the foot. Each icon link is named by its place (its label is read,
 * and shown as a tooltip under the pointer); the current one is filled and has a 6px orange dot
 * at its left, and says aria-current. The drawer (264px, from the left over a 50% scrim) is the
 * desktop sidebar's contents with « at its top right: focus moves into it and stays there, Escape,
 * «, the scrim or choosing a place closes it, and focus goes back to ».
 */
export function OrganiserRail({ organiser, pathname }: { organiser: Organiser; pathname: string }) {
  const { items, logOut } = useOrganiserNav(pathname);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // The drawer is the rail's sibling, not inside it: were the window widened past 1024px while it's
  // open, a modal inside the hidden rail would vanish and leave the page inert.
  return (
    <>
      <aside
        data-surface="ink"
        data-organiser-rail=""
        aria-label={ASIDE_LABEL}
        className="flex w-16 shrink-0 flex-col items-center gap-2 px-2 py-6 lg:hidden"
      >
        <OrganiserAvatar name={organiser.displayName} logoUrl={organiser.logoUrl} size="rail" />
        <button
          type="button"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          data-organiser-expand=""
          className={RAIL_TARGET}
        >
          <ExpandIcon />
        </button>
        <span aria-hidden="true" className="h-px w-8 shrink-0 bg-surface-border" />
        <nav aria-label={NAV_LABEL}>
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const current = ariaCurrent(item.current);
              return (
                <li key={item.key} className="flex">
                  <Link
                    href={item.href}
                    aria-current={current}
                    title={item.label}
                    data-organiser-rail-item={item.key}
                    className={`relative ${RAIL_TARGET} ${current ? "bg-surface" : ""}`}
                  >
                    <Icon />
                    <span className="sr-only">{item.label}</span>
                    {current && (
                      <span aria-hidden="true" className="absolute top-1/2 left-1 size-1.5 -translate-y-1/2 rounded-full bg-signal" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div aria-hidden="true" className="flex-1" />
        <button type="button" aria-label="Log out" title="Log out" onClick={logOut} className={RAIL_TARGET}>
          <LogOutIcon />
        </button>
      </aside>
      <DashDrawer open={open} onClose={close} side="left" label="Organiser menu" name="organiser-drawer">
        <div className={`relative flex min-h-full ${SIDEBAR_COLUMN}`}>
          <button
            type="button"
            aria-label="Close menu"
            onClick={close}
            data-organiser-collapse=""
            className={`absolute top-4 right-2 ${RAIL_TARGET}`}
          >
            <CollapseIcon />
          </button>
          <DashSidebarBody
            area="organiser"
            avatar={<OrganiserAvatar name={organiser.displayName} logoUrl={organiser.logoUrl} size="sidebar" />}
            name={organiser.displayName}
            meta={ORGANISER_META}
            navLabel={NAV_LABEL}
            items={items}
            onLogOut={logOut}
            logOutTone="plain"
            onNavigate={close}
          />
        </div>
      </DashDrawer>
    </>
  );
}
