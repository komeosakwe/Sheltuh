"use client";

import DemoNotice from "@/components/DemoNotice";
import BlockedList from "./BlockedList";
import DemoMessages from "./DemoMessages";
import Inbox from "./Inbox";
import MessagesGate from "./MessagesGate";
import Thread from "./Thread";
import { threadHref } from "./shared";

/** /messages */
export function InboxPageContent() {
  return (
    <MessagesGate returnTo="/messages" demo={<DemoMessages />}>
      {(getToken) => <Inbox getToken={getToken} />}
    </MessagesGate>
  );
}

/** /messages/[conversationId]. The thread lays itself out (it fills the screen on phones). */
export function ThreadPageContent({ conversationId }: { conversationId: string }) {
  return (
    <MessagesGate
      returnTo={threadHref(conversationId)}
      frameClassName="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-20"
      pageTitle="Conversation"
      demo={
        <>
          <h1 className="display-lg">Messages</h1>
          <DemoMessages />
        </>
      }
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
