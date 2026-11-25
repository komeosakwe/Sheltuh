"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import DashFrame from "@/components/dashboard/ui/DashFrame";
import AccountSidebar from "./AccountSidebar";
import AccountTabs from "./AccountTabs";
import { useAccountNav } from "./useAccountNav";

/**
 * The customer account area's frame (Latte's 1120 frames; docs/design/account-dashboard.md): the
 * shared dashboard frame (components/dashboard/ui/DashFrame.tsx, also the organiser area's) with
 * the 264px black sidebar on a desktop (AccountSidebar) and, below 1024px, the Account tabs row
 * across the top of the panel (AccountTabs).
 */
export default function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { account, items, summary } = useAccountNav(pathname);

  return (
    <DashFrame
      area="account"
      sidebar={<AccountSidebar account={account} items={items} summary={summary} />}
      top={
        <div className="lg:hidden">
          <AccountTabs items={items} />
        </div>
      }
    >
      {children}
    </DashFrame>
  );
}
