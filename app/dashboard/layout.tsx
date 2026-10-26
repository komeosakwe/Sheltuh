import OrganiserSubNav from "@/components/dashboard/OrganiserSubNav";

/** Every organiser page: the organiser sub-nav (hidden at the door scanner), then the page. */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <>
      <OrganiserSubNav />
      {children}
    </>
  );
}
