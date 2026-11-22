import type { Metadata } from "next";
import { ThreadPageContent } from "@/components/messages/MessagesPages";

export const metadata: Metadata = { title: "Conversation — Sheltüh" };

export default async function ConversationPage({ params }: PageProps<"/messages/[conversationId]">) {
  const { conversationId } = await params;
  return <ThreadPageContent conversationId={conversationId} />;
}
