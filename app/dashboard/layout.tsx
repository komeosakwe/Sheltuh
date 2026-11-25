import OrganiserShell from "@/components/dashboard/OrganiserShell";

/** Every organiser page: the dashboard frame and nav for an approved organiser (not at the door scanner or the seat-map editor), then the page. */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <OrganiserShell>{children}</OrganiserShell>;
}
