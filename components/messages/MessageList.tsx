import type { Ref } from "react";
import type { MessageRecord } from "@/lib/api/types";
import { formatMessageTime } from "@/lib/format";

/**
 * A conversation's messages, oldest first. Bodies are plain text rendered
 * as React text (never HTML, never auto-linked), keeping their line breaks
 * (`whitespace-pre-wrap`) and wrapping long words and URLs (`break-words`).
 * Yours sit on the right in ink; theirs on the left on paper.
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
          className={`flex min-w-0 max-w-5/6 flex-col gap-1 outline-offset-2 ${
            message.fromYou ? "items-end self-end" : "items-start self-start"
          } ${newFrom?.has(message.messageId) ? "fade-in" : ""}`.trim()}
        >
          <span className="sr-only">{message.fromYou ? "You" : otherName}:</span>
          <p
            className={`max-w-full px-3.5 py-2.5 text-base leading-6 break-words whitespace-pre-wrap sm:text-sm sm:leading-5 ${
              message.fromYou ? "bg-foreground text-background" : "bg-surface text-foreground"
            }`}
          >
            {message.body}
          </p>
          <time dateTime={message.sentAt} className="text-xs text-muted">
            {formatMessageTime(message.sentAt, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
