"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import DashDrawer from "@/components/dashboard/ui/DashDrawer";
import DashSidebar, { ariaCurrent, DashSidebarBody, SIDEBAR_COLUMN, type DashNavItem } from "@/components/dashboard/ui/DashSidebar";
import {
  CalendarIcon,
  ChartIcon,
  CollapseIcon,
  ExpandIcon,
  GridIcon,
  LogOutIcon,
  StoreIcon,
  WalletIcon,
} from "@/components/dashboard/ui/icons";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { ORGANISER_NAV, organiserCurrent, type OrganiserNavIcon } from "@/lib/organiser-nav";
import OrganiserAvatar from "./OrganiserAvatar";

const ICONS: Record<OrganiserNavIcon, ComponentType<{ className?: string }>> = {
  grid: GridIcon,
  calendar: CalendarIcon,
  chart: ChartIcon,
  wallet: WalletIcon,
  store: StoreIcon,
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

/** The » / « buttons: 48 × 48, radius 8, the icon centred, filled #1f1f1f (surface on ink) under the pointer or focus. */
const RAIL_BUTTON =
  "inline-flex size-12 shrink-0 items-center justify-center rounded-control text-foreground hover:bg-surface focus-visible:bg-surface motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out";

/**
 * A rail place (and Log out): its icon over its short label (Label/Tag), 56px wide and at least
 * 56px tall. Under the pointer or keyboard focus it fills #333 (border/subtle on ink); the current
 * place fills #1f1f1f with the orange dot, so the two never look alike.
 */
function railItemClass(current: boolean) {
  return `relative flex min-h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-control px-0 py-1.5 text-center text-foreground motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
    current ? "bg-surface" : "hover:bg-surface-border focus-visible:bg-surface-border"
  }`;
}

/** The label under a rail icon: Label/Tag, wrapping (never cut) if larger text makes it wider than the rail. */
const RAIL_LABEL = "label-tag max-w-full break-words";

/** After a place is chosen in the drawer: focus the new page's h1 once it's there (up to 3s), so a keyboard or screen-reader user starts at the page. */
function focusPageHeading() {
  const started = performance.now();
  const tryFocus = () => {
    const heading = document.querySelector<HTMLElement>("[data-organiser-main] h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus();
      return;
    }
    if (performance.now() - started < 3000) window.setTimeout(tryFocus, 100);
  };
  tryFocus();
}

/**
 * The organiser's tablet and phone navigation (Latte's "Org / Sidebar · Collapsed" 495:19097 and
 * "Nav expanded" 495:22558 / 495:22467, below 1024px): a 64px black rail down the panel's left
 * with their 40px mark, » (opens the full sidebar as a drawer), a divider, each place as its icon
 * over a short visible label (Latte draws icons alone; the labels say what they are without a
 * hover, which touch screens don't have), and Log out at the foot. The current place is filled,
 * has a 6px orange dot at its left, and says aria-current. The drawer (264px, from the left over a
 * 50% scrim) is the desktop sidebar's contents with « at its top right: focus moves into it and
 * goes round inside, Escape, «, the scrim or choosing a place closes it; focus goes back to », or
 * to the new page's heading when a place was chosen.
 */
export function OrganiserRail({ organiser, pathname }: { organiser: Organiser; pathname: string }) {
  const { items, logOut } = useOrganiserNav(pathname);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const headingNext = useRef(false);

  useEffect(() => {
    if (!headingNext.current) return;
    headingNext.current = false;
    focusPageHeading();
  }, [pathname]);

  function chose() {
    headingNext.current = true;
    setOpen(false);
  }

  // The drawer is the rail's sibling, not inside it: were the window widened past 1024px while it's
  // open, a modal inside the hidden rail would vanish and leave the page inert.
  return (
    <>
      <aside
        data-surface="ink"
        data-organiser-rail=""
        aria-label={ASIDE_LABEL}
        className="flex w-16 shrink-0 flex-col items-center gap-2 px-1 py-6 lg:hidden"
      >
        <OrganiserAvatar name={organiser.displayName} logoUrl={organiser.logoUrl} size="rail" />
        <button
          type="button"
          aria-label="Show organiser menu"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Show organiser menu"
          onClick={() => setOpen(true)}
          data-organiser-expand=""
          className={RAIL_BUTTON}
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
                    data-organiser-rail-item={item.key}
                    className={railItemClass(current !== undefined)}
                  >
                    <Icon />
                    <span className={RAIL_LABEL}>{item.label}</span>
                    {current && (
                      <span aria-hidden="true" className="absolute top-4.5 left-0.5 size-1.5 rounded-full bg-signal" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div aria-hidden="true" className="flex-1" />
        <button type="button" onClick={logOut} className={railItemClass(false)}>
          <LogOutIcon />
          <span className={RAIL_LABEL}>Log out</span>
        </button>
      </aside>
      <DashDrawer open={open} onClose={close} side="left" label="Organiser menu" name="organiser-drawer">
        <div className={`relative flex min-h-full ${SIDEBAR_COLUMN}`}>
          <button
            type="button"
            aria-label="Hide organiser menu"
            title="Hide organiser menu"
            onClick={close}
            data-organiser-collapse=""
            className={`absolute top-4 right-2 ${RAIL_BUTTON}`}
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
            onNavigate={chose}
          />
        </div>
      </DashDrawer>
    </>
  );
}
