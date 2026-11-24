"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AccountSidebar from "./AccountSidebar";
import AccountTabs from "./AccountTabs";
import { useAccountNav } from "./useAccountNav";

/**
 * The customer account area's frame (Latte's 1120 frames; docs/design/account-dashboard.md):
 * the page on surface/muted, a white panel ("Shell") holding the page, and the way between the
 * account's pages.
 *
 * - Desktop (from 1024px): the panel is rounded (16), at least 960px tall, 32px below the header
 *   and 64px above the footer, 64px in from the sides from 1280px (32px below that) and up to 1440px wide
 *   at most; the 264px black sidebar on its left (AccountSidebar), the page on the right with 56px
 *   above it, 40px right and below, 48px left.
 * - Tablet (768–1023px): no sidebar; the panel is rounded, 24px in (24 top and sides, 32 below), the
 *   Account tabs row across its top (AccountTabs) and 24px around the page.
 * - Phones: the panel is full-bleed with no radius, the tabs row on top, 24px above and below the
 *   page and 16px at the sides.
 *
 * Pages stack their parts 24px apart (the frames' Main gap).
 */
export default function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { account, items, summary } = useAccountNav(pathname);

  return (
    <div data-account-body="" className="bg-surface md:px-6 md:pt-6 md:pb-8 lg:px-8 lg:pt-8 lg:pb-16 xl:px-16">
      <div
        data-account-shell=""
        className="overflow-clip bg-background md:rounded-card lg:mx-auto lg:flex lg:min-h-240 lg:max-w-328"
      >
        <AccountSidebar account={account} items={items} summary={summary} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="lg:hidden">
            <AccountTabs items={items} />
          </div>
          <div data-account-main="" className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 md:p-6 lg:pt-14 lg:pr-10 lg:pb-10 lg:pl-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
