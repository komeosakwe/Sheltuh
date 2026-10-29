import DemoNotice from "@/components/DemoNotice";
import { sampleConversations } from "@/lib/sample-messages";
import { ConversationRow } from "./Inbox";

/**
 * /messages in demo mode (no API): the sample conversations
 * (lib/sample-messages.ts) in the live inbox's rows. Nothing calls the API.
 */
export default function DemoInbox() {
  const conversations = sampleConversations();
  return (
    <div className="flex flex-col gap-6">
      <DemoNotice>Sample conversations.</DemoNotice>
      <ul aria-label="Conversations" className="border-t border-foreground">
        {conversations.map((conversation, index) => (
          <ConversationRow key={conversation.conversationId} conversation={conversation} index={index} />
        ))}
      </ul>
    </div>
  );
}
