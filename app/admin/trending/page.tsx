import type { Metadata } from "next";
import AdminPage from "@/components/admin/AdminPage";
import AdminTrendingList from "@/components/admin/AdminTrendingList";

export const metadata: Metadata = { title: "Trending — Sheltüh admin" };

export default function AdminTrendingPage() {
  return (
    <AdminPage
      crumbs={[{ href: "/admin", label: "Admin" }]}
      title="Trending"
      intro="Best first. To bring back an event you kept out, open its Trending panel under Events."
    >
      <AdminTrendingList />
    </AdminPage>
  );
}
