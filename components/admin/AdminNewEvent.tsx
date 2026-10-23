"use client";

import { useRouter } from "next/navigation";
import EventEditor from "@/components/dashboard/EventEditor";
import { useAuth } from "@/lib/auth/AuthContext";

/** /admin/events/new: the event editor in admin mode (inside AdminGate). */
export default function AdminNewEvent() {
  const auth = useAuth();
  const router = useRouter();
  return (
    <EventEditor
      mode="admin"
      getToken={auth.getAccessToken}
      onSaved={(record) => router.push(`/admin/events/${encodeURIComponent(record.eventId)}/edit`)}
    />
  );
}
