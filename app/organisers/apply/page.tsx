import type { Metadata } from "next";
import OrganisersPage from "@/components/organisers/OrganisersPage";

export const metadata: Metadata = { title: "For organisers — Sheltüh" };

export default function OrganiserApplyPage() {
  return <OrganisersPage />;
}
