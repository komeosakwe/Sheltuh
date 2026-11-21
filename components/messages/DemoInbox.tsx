import DemoNotice from "@/components/DemoNotice";
import { sampleConversations } from "@/lib/sample-messages";
import { CONVERSATIONS_PANEL_CLASS, ConversationRow } from "./Inbox";

/**
 * The conversation list in demo mode (no API): the sample conversations
 * (lib/sample-messages.ts) in the live inbox's rows and panel. Nothing calls the API.
 */
export default function DemoInbox({ selectedId }: { selectedId?: string | null }) {
  const conversations = sampleConversations();
  return (
    <div className={CONVERSATIONS_PANEL_CLASS}>
      <div className="p-2">
        <DemoNotice>Sample conversations.</DemoNotice>
      </div>
      <ul aria-label="Conversations" className="flex flex-col gap-1">
        {conversations.map((conversation, index) => (
          <ConversationRow
            key={conversation.conversationId}
            conversation={conversation}
            index={index}
            selected={conversation.conversationId === selectedId}
          />
        ))}
      </ul>
    </div>
  );
}
