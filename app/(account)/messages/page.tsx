import type { Metadata } from "next";
import { PickConversation } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Messages — Sheltüh" };

/** /messages: the list (in the layout) and, from 768px, a panel that says to pick a conversation. */
export default function MessagesPage() {
  return <PickConversation />;
}
