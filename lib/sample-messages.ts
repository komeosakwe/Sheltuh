import type { ConversationSummary, MessageRecord } from "@/lib/api/types";

/**
 * A fixed, fictional conversation for demo mode (no API), so /messages can be
 * previewed. Static text and fixed timestamps: the server render and the
 * browser's hydration always agree.
 */
export const SAMPLE_CONVERSATION: ConversationSummary = {
  conversationId: "sample",
  otherDisplayName: "Priya R.",
  status: "active",
  event: { title: "Neon Static", slug: "neon-static" },
  lastMessage: { preview: "See you by the merch table 🙌", sentAt: "2026-09-26T09:12:00.000Z", fromYou: false },
  unread: false,
};

/** "Now" for formatting the sample's times, fixed so they render the same everywhere. */
export const SAMPLE_NOW = new Date("2026-09-26T10:00:00.000Z");

export const SAMPLE_MESSAGES: MessageRecord[] = [
  {
    messageId: "1",
    body: "Hi! Saw you're going to Neon Static on Saturday. First time seeing them live?",
    sentAt: "2026-09-26T08:40:00.000Z",
    fromYou: false,
  },
  {
    messageId: "2",
    body: "Hey! Second time. They were so good at the Corner last year.\nAre you heading down early?",
    sentAt: "2026-09-26T08:52:00.000Z",
    fromYou: true,
  },
  {
    messageId: "3",
    body: "Planning to get there for the support act. See you by the merch table 🙌",
    sentAt: "2026-09-26T09:12:00.000Z",
    fromYou: false,
  },
];
