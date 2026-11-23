import type { Ref } from "react";
import type { MessageRecord } from "@/lib/api/types";
import { formatMessageTime } from "@/lib/format";

/**
 * A conversation's messages, oldest first. Bodies are plain text rendered
 * as React text (never HTML, never auto-linked), keeping their line breaks
 * (`whitespace-pre-wrap`) and wrapping long words and URLs (`break-words`).
 * As Latte's Messages frames: each a bubble (radius 16, 16 × 12 in, at most 392px wide, and never wider
 * than the thread, so a long unbroken word wraps inside it rather than spilling out) with its
 * time inside it in IBM Plex Mono 12/16; yours on the right, black with the time in text/disabled
 * (#a3a3a3, 8.3:1); theirs on the left on surface/muted with the time in text/secondary.
 *
 * Each item is focusable (`tabIndex=-1`, never in the tab order) so focus
 * can be moved to messages that were just loaded.
 */
export default function MessageList({
  messages,
  otherName,
  now,
  listRef,
  newFrom,
}: {
  messages: MessageRecord[];
  otherName: string;
  /** "Now" for choosing between "8:05 pm" and "Fri 25 Sep, 8:05 pm". */
  now?: Date;
  listRef?: Ref<HTMLOListElement>;
  /** Messages with an id in here just arrived: they fade in. */
  newFrom?: ReadonlySet<string>;
}) {
  return (
    <ol ref={listRef} aria-label={`Messages with ${otherName}`} className="flex flex-col gap-3">
      {messages.map((message) => (
        <li
          key={message.messageId}
          data-message-id={message.messageId}
          tabIndex={-1}
          className={`flex w-fit min-w-0 max-w-[min(100%,24.5rem)] flex-col gap-1 rounded-card px-4 py-3 outline-offset-2 ${
            message.fromYou ? "items-end self-end bg-foreground text-background" : "items-start self-start bg-surface text-foreground"
          } ${newFrom?.has(message.messageId) ? "fade-in" : ""}`.trim()}
        >
          <span className="sr-only">{message.fromYou ? "You" : otherName}:</span>
          <p className="body-s max-w-full break-words whitespace-pre-wrap">{message.body}</p>
          <time
            dateTime={message.sentAt}
            className={`font-mono text-xs leading-4 ${message.fromYou ? "text-disabled" : "text-muted"}`}
          >
            {formatMessageTime(message.sentAt, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
