import type { Metadata } from "next";
import ProfilePageContent from "@/components/account/ProfilePageContent";

export const metadata: Metadata = { title: "Profile — Sheltüh" };

export default function ProfilePage() {
  return <ProfilePageContent />;
}
