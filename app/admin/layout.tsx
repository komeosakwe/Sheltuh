import AdminShell from "@/components/admin/AdminShell";

/**
 * Every /admin page: gated to admins once here (AdminShell, with AdminGate's
 * messages for anyone else, the demo included), with the admin sub-nav and
 * its counts (AdminSummaryProvider, in the root layout beside the main nav).
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
