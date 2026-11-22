"use client";

import { useEffect, useRef, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button } from "@/components/ui/Button";
import type { MessageRecord } from "@/lib/api/types";
import { endSentence } from "@/lib/display-name";
import { getSampleThread } from "@/lib/sample-messages";
import Composer, { type SendOutcome } from "./Composer";
import MessageList from "./MessageList";
import ReportDialog, { type ReportOutcome } from "./ReportDialog";
import {
  BLOCK_EFFECT,
  COMPOSER_BAR_CLASS,
  THREAD_ACTION_CLASS,
  THREAD_HEADER_CLASS,
  THREAD_HEADER_ROW_CLASS,
  THREAD_MESSAGES_CLASS,
  THREAD_PAGE_CLASS,
  THREAD_STATE_CLASS,
  scrollThreadToEnd,
  threadHref,
} from "./shared";
import ThreadTitle from "./ThreadTitle";

type Focus = "block-open" | "block-close" | "reported";

/**
 * /messages/[conversationId] in demo mode (no API): a sample member's
 * conversation (lib/sample-messages.ts) in the live thread's layout and
 * parts. What you send is added to the page's own state only: nothing is
 * stored or sent, and it's gone when you leave. Block and Report say what
 * they'd do on the live site, and do nothing. An id that isn't a sample
 * conversation gets the live thread's "isn't available".
 */
export default function DemoThread({ conversationId }: { conversationId: string }) {
  const [thread] = useState(() => getSampleThread(conversationId));
  const [messages, setMessages] = useState<MessageRecord[]>(() => thread?.messages ?? []);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const sentCount = useRef(0);
  const pendingFocus = useRef<Focus | null>(null);
  const pendingScroll = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const reportedRef = useRef<HTMLDivElement>(null);
  const name = thread?.otherDisplayName;

  useEffect(() => {
    if (name) document.title = `${name} — Messages — Sheltüh`;
  }, [name]);

  // Focus and scroll once the render that needs them has committed.
  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus) {
      const target =
        focus === "reported"
          ? reportedRef.current
          : document.getElementById(focus === "block-open" ? "thread-block" : "thread-block-cancel");
      if (target) {
        pendingFocus.current = null;
        target.focus();
      }
    }
    if (pendingScroll.current && endRef.current) {
      pendingScroll.current = false;
      scrollThreadToEnd(sectionRef.current, endRef.current, { force: true });
    }
  });

  if (!thread || !name) {
    return (
      <div className={THREAD_STATE_CLASS}>
        <div>
          <h1 className="heading-h4">This conversation isn&rsquo;t available</h1>
          <p className="mt-3 max-w-md text-sm text-muted">This demo only has conversations with its sample members.</p>
        </div>
      </div>
    );
  }

  async function send(body: string): Promise<SendOutcome> {
    sentCount.current += 1;
    const message: MessageRecord = {
      messageId: `demo-${sentCount.current}`,
      body,
      sentAt: new Date().toISOString(),
      fromYou: true,
    };
    setMessages((current) => [...current, message]);
    setNewIds(new Set([message.messageId]));
    pendingScroll.current = true;
    setAnnouncement((current) => ({ text: "Message added. It isn’t sent in this demo.", n: current.n + 1 }));
    return { ok: true };
  }

  async function report(): Promise<ReportOutcome> {
    setReportOpen(false);
    setReported(true);
    pendingFocus.current = "reported";
    return { ok: true };
  }

  return (
    <div className={THREAD_PAGE_CLASS}>
      <header className={THREAD_HEADER_CLASS}>
        <div className={THREAD_HEADER_ROW_CLASS}>
          <ThreadTitle name={name} event={thread.event} />
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className={THREAD_ACTION_CLASS}
              onClick={() => {
                setReported(false);
                setReportOpen(true);
              }}
            >
              Report
            </Button>
            <Button
              id="thread-block"
              variant="outline"
              size="sm"
              className={THREAD_ACTION_CLASS}
              aria-expanded={blockOpen}
              onClick={() => {
                pendingFocus.current = blockOpen ? null : "block-close";
                setBlockOpen((open) => !open);
              }}
            >
              Block
            </Button>
          </div>
        </div>
        {blockOpen && (
          <div
            role="group"
            aria-labelledby="block-confirm-text"
            className="flex flex-col gap-3 rounded-card border border-foreground bg-card p-4"
          >
            <p id="block-confirm-text" className="text-sm font-semibold">
              Block {name}?
            </p>
            <p className="text-sm leading-5">
              {BLOCK_EFFECT} You also won&rsquo;t see each other on Who&rsquo;s Going lists. You can unblock them later.
            </p>
            <DemoNotice>Blocking isn&rsquo;t available in this demo, so nothing changes.</DemoNotice>
            <Button
              id="thread-block-cancel"
              variant="outline"
              size="lg"
              onClick={() => {
                setBlockOpen(false);
                pendingFocus.current = "block-open";
              }}
              className="w-full sm:w-auto sm:self-start"
            >
              Close
            </Button>
          </div>
        )}
        {reported && (
          <div ref={reportedRef} tabIndex={-1} className="outline-offset-2">
            <DemoNotice>
              On the live site, our team would review your report, and we wouldn&rsquo;t tell {endSentence(name)} Nothing was sent
              in this demo.
            </DemoNotice>
          </div>
        )}
        <DemoNotice>Messages aren&rsquo;t sent in this demo.</DemoNotice>
      </header>

      <section ref={sectionRef} aria-labelledby="thread-messages-title" className={THREAD_MESSAGES_CLASS}>
        <h2 id="thread-messages-title" className="sr-only">
          Messages
        </h2>
        {messages.length > 0 ? (
          <MessageList messages={messages} otherName={name} newFrom={newIds} />
        ) : (
          <p className="text-sm text-muted">No messages yet. Say hello to {endSentence(name)}</p>
        )}
        {/* The end of the messages, inside their scroll container. */}
        <div ref={endRef} />
      </section>

      <div className={COMPOSER_BAR_CLASS}>
        <Composer otherName={name} mode="reply" onSend={send} returnTo={threadHref(conversationId)} />
      </div>
      <ReportDialog
        open={reportOpen}
        otherName={name}
        onClose={() => setReportOpen(false)}
        onSubmit={report}
        returnTo={threadHref(conversationId)}
      />
      <p role="status" className="sr-only">
        <span key={announcement.n}>{announcement.text}</span>
      </p>
    </div>
  );
}
