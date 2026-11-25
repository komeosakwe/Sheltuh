import AccountShell from "@/components/account/AccountShell";

/**
 * The customer account area: /profile, /account (Settings), /saved and /messages, in one frame (the desktop
 * sidebar, the tablet / mobile Account tabs; components/account/AccountShell.tsx). A route group,
 * so the URLs don't change.
 */
export default function AccountLayout({ children }: LayoutProps<"/">) {
  return <AccountShell>{children}</AccountShell>;
}
