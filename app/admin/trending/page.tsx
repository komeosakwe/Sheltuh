import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import AdminTrendingList from "@/components/admin/AdminTrendingList";

export const metadata: Metadata = { title: "Trending — Sheltüh admin" };

export default function AdminTrendingPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Trending"
      intro="What the home page’s Trending section shows now, best first. Open an event to boost it or keep it out. To bring back an event you kept out, find it under Events and open its Trending panel."
    >
      <AdminTrendingList />
    </AdminPage>
  );
}
