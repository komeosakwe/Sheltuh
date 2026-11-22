"use client";

import DemoNotice from "@/components/DemoNotice";
import BlockedList from "./BlockedList";
import DemoThread from "./DemoThread";
import MessagesGate from "./MessagesGate";
import Thread from "./Thread";
import { THREAD_STATE_CLASS, threadHref } from "./shared";

/**
 * /messages beside the list (from 768px): where a conversation opens. Below 768px the list is the
 * page, so it isn't shown.
 */
export function PickConversation() {
  return (
    <div className="hidden min-w-0 flex-1 items-center justify-center rounded-card border border-surface-border p-6 md:flex md:h-169 lg:h-191">
      <p className="body-s text-center text-muted">Pick a conversation to read it here.</p>
    </div>
  );
}

/** /messages/[conversationId]. The thread (live or demo) lays itself out (it fills the screen on phones). */
export function ThreadPageContent({ conversationId }: { conversationId: string }) {
  return (
    <MessagesGate
      returnTo={threadHref(conversationId)}
      frameClassName={THREAD_STATE_CLASS}
      pageTitle="Conversation"
      demo={<DemoThread key={conversationId} conversationId={conversationId} />}
    >
      {(getToken) => <Thread key={conversationId} conversationId={conversationId} getToken={getToken} />}
    </MessagesGate>
  );
}

/** /messages/blocked */
export function BlockedPageContent() {
  return (
    <MessagesGate
      returnTo="/messages/blocked"
      demo={<DemoNotice>Blocking isn&rsquo;t available in this demo.</DemoNotice>}
    >
      {(getToken) => <BlockedList getToken={getToken} />}
    </MessagesGate>
  );
}
