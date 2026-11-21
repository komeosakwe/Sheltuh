"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import AccountPageHead from "@/components/account/AccountPageHead";
import DemoInbox from "./DemoInbox";
import Inbox from "./Inbox";
import { InboxSyncProvider } from "./InboxSync";
import MessagesGate from "./MessagesGate";
import { THREAD_STATE_CLASS } from "./shared";

/**
 * /messages and its conversations as one split view (Latte's Messages frames): the page title,
 * then the conversation list (cream, 280px from 768px, 360px from 1280px) beside the open
 * conversation, which is the page (`children`: a thread, or on /messages a panel that says to
 * pick one). Below 768px the list sits above the conversation. The list stays mounted while you
 * move between conversations, and reloads (InboxSync) when the open one changes something or you
 * move to another conversation or back to /messages. /messages/blocked is a page of its own.
 *
 * On /messages the title is the page's h1; on a conversation the other person's name is (the
 * thread's own heading), and the title is shown in the same style as a paragraph. Blocked members
 * is reached from Settings → Privacy (the frames have no link here).
 */
export default function MessagesFrame({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const pathname = usePathname() ?? "/messages";
  if (segment === "blocked") return children;
  const selectedId = segment ? decodeURIComponent(segment) : null;

  const split = (list: ReactNode) => (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      {list}
      {children}
    </div>
  );

  return (
    <InboxSyncProvider>
      <AccountPageHead
        as={selectedId ? "p" : "h1"}
        title="Messages"
        intro="Chat with people going to the same events."
      />
      <MessagesGate
        returnTo={pathname}
        frameClassName={THREAD_STATE_CLASS}
        pageTitle={selectedId ? "Conversation" : undefined}
        demo={split(<DemoInbox selectedId={selectedId} />)}
      >
        {(getToken) => split(<Inbox getToken={getToken} selectedId={selectedId} />)}
      </MessagesGate>
    </InboxSyncProvider>
  );
}
