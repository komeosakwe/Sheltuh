import OrganiserShell from "@/components/dashboard/OrganiserShell";

/** Every organiser page: the organiser sub-nav for an approved organiser (hidden at the door scanner), then the page. */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <OrganiserShell>{children}</OrganiserShell>;
}
