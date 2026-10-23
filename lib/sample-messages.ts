import type { ConversationSummary, MessageRecord } from "@/lib/api/types";
import { sampleMemberById } from "@/lib/sample-members";

/**
 * Demo-mode messages (no API): a conversation with each sample member
 * (lib/sample-members.ts), whose id is the member's profile id. A few have
 * fixed, fictional history and make up the demo inbox; the rest start empty,
 * from Message on the member's profile. What you send in the demo stays in
 * the page (components/messages/DemoThread.tsx): nothing is stored or sent.
 * Static text and fixed timestamps, so the server render and the browser's
 * hydration agree.
 */

export interface SampleThread {
  conversationId: string;
  otherDisplayName: string;
  /** The event both are going to, as a live conversation names it. */
  event?: { title: string; slug: string };
  /** Oldest first. */
  messages: MessageRecord[];
}

interface SampleHistory {
  event: { title: string; slug: string };
  messages: MessageRecord[];
}

const HISTORY: Readonly<Record<string, SampleHistory>> = {
  "priya-r": {
    event: { title: "Neon Static", slug: "neon-static" },
    messages: [
      {
        messageId: "1",
        body: "Hi! Saw you're going to Neon Static on Friday. First time seeing them live?",
        sentAt: "2026-09-24T08:40:00.000Z",
        fromYou: false,
      },
      {
        messageId: "2",
        body: "Hey! Second time. They were so good at the Corner last year.\nAre you heading down early?",
        sentAt: "2026-09-24T08:52:00.000Z",
        fromYou: true,
      },
      {
        messageId: "3",
        body: "Planning to get there for the support act. See you by the merch table 🙌",
        sentAt: "2026-09-24T09:12:00.000Z",
        fromYou: false,
      },
    ],
  },
  "ben-b": {
    event: { title: "Brunswick Zine Fair", slug: "brunswick-zine-fair" },
    messages: [
      {
        messageId: "1",
        body: "Are you tabling at the zine fair or just browsing?",
        sentAt: "2026-09-22T03:05:00.000Z",
        fromYou: false,
      },
      {
        messageId: "2",
        body: "Just browsing this time. I'll come find your table though!",
        sentAt: "2026-09-22T03:20:00.000Z",
        fromYou: true,
      },
    ],
  },
  "maeve-d": {
    event: { title: "Dead Letter Office", slug: "dead-letter-office" },
    messages: [
      {
        messageId: "1",
        body: "I've got a spare seat next to me for Dead Letter Office if you're going solo. Drink at the bar first?",
        sentAt: "2026-09-20T10:30:00.000Z",
        fromYou: false,
      },
    ],
  },
};

/** The demo conversation with this id (a sample member's profile id), or null. */
export function getSampleThread(conversationId: string): SampleThread | null {
  const member = sampleMemberById(conversationId);
  if (!member) return null;
  const history = HISTORY[member.profileId];
  return {
    conversationId: member.profileId,
    otherDisplayName: member.displayName,
    event: history?.event,
    messages: history?.messages ?? [],
  };
}

/** The demo inbox: the conversations with history, most recent first, as the API lists them. */
export function sampleConversations(): ConversationSummary[] {
  return Object.keys(HISTORY)
    .map((conversationId) => getSampleThread(conversationId))
    .filter((thread): thread is SampleThread => thread !== null && thread.messages.length > 0)
    .map((thread) => {
      const last = thread.messages[thread.messages.length - 1];
      return {
        conversationId: thread.conversationId,
        otherDisplayName: thread.otherDisplayName,
        status: "active" as const,
        event: thread.event,
        lastMessage: { preview: last.body.slice(0, 140), sentAt: last.sentAt, fromYou: last.fromYou },
        unread: false,
      };
    })
    .sort((a, b) => Date.parse(b.lastMessage.sentAt) - Date.parse(a.lastMessage.sentAt));
}
