"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type Ref } from "react";
import DemoNotice from "@/components/DemoNotice";
import { RESULTS_GRID } from "@/components/EventResults";
import { ComposeRequestForm } from "@/components/messages/ComposeRequest";
import ReportDialog, { type ReportOutcome } from "@/components/messages/ReportDialog";
import { BLOCK_EFFECT, errorText, messagingError, tallInlineLinkClass, threadHref } from "@/components/messages/shared";
import { Button, ButtonLink } from "@/components/ui/Button";
import EventCard from "@/components/ui/EventCard";
import { EmptyState, Notice } from "@/components/ui/Section";
import SectionHead from "@/components/ui/SectionHead";
import Strap from "@/components/ui/Strap";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { GetToken } from "@/lib/api/client";
import { blockMember, reportMember } from "@/lib/api/messages";
import type { ConversationSummary, MemberProfile, ReportReason } from "@/lib/api/types";
import { endSentence } from "@/lib/display-name";
import type { SheltuhEvent } from "@/lib/types";
import MemberAvatar from "./MemberAvatar";

const REPORT_ERROR = "Couldn’t send your report. Try again.";
const REPORT_RATE_LIMITED = "You’ve sent a lot of reports today. Try again tomorrow.";
const BLOCK_RATE_LIMITED = "You’ve blocked a lot of people today. Try again tomorrow.";

type Focus = "compose-open" | "sent" | "block-cancel" | "block-open" | "reported" | "heading";

/**
 * A member's profile as other members see it (docs/architecture.md, "Member
 * profiles"): their photo (or initials), name, bio, Instagram, the upcoming
 * events they've added themselves to, and Message, Block and Report. Your
 * own profile says it's how others see you, with a link to edit it, and has
 * no actions. Everything is the member's own text, shown as text (a bio's
 * links aren't made clickable).
 *
 * `events`: their upcoming events, already in the screens' shape (a live
 * profile's adapted by LiveMemberProfile, or the demo's samples).
 *
 * `live`: the API's side. `onGone`: the member can no longer be seen (a
 * block's or message's 404); `onBlocked`: the caller blocked them. Without
 * it (the demo, lib/sample-member-profiles.ts) nothing calls the API:
 * Message opens the demo conversation, and Block and Report say what they
 * would do on the live site.
 */
export default function MemberProfileView({
  profile,
  events,
  headingRef,
  live,
}: {
  profile: Omit<MemberProfile, "upcomingEvents">;
  events: readonly SheltuhEvent[];
  headingRef?: Ref<HTMLHeadingElement>;
  live?: { getToken: GetToken; onGone: () => void; onBlocked: (name: string) => void };
}) {
  const name = profile.displayName;
  const returnTo = `/members/${encodeURIComponent(profile.profileId)}`;
  const [composing, setComposing] = useState(false);
  const [sent, setSent] = useState<ConversationSummary | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const pendingFocus = useRef<Focus | null>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);
  const reportedRef = useRef<HTMLDivElement>(null);

  // Focus follows the person's own actions, once the new state has rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element =
      target === "sent"
        ? sentRef.current
        : target === "reported"
          ? reportedRef.current
          : document.getElementById(`member-${target}`);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  async function block() {
    if (blockBusy || !live) return;
    setBlockBusy(true);
    setActionError(null);
    try {
      await blockMember({ profileId: profile.profileId }, live.getToken);
      live.onBlocked(name);
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: BLOCK_RATE_LIMITED, fallback: "Couldn’t block. Try again." });
      if (mapped.kind === "unavailable") live.onGone();
      else setActionError(errorText(mapped, "Couldn’t block. Try again."));
      setBlockBusy(false);
    }
  }

  /** `reportToken`: the dialog's, bound to the account that wrote the report. */
  async function report(reason: ReportReason, details: string | undefined, reportToken: GetToken): Promise<ReportOutcome> {
    if (!live) {
      // The demo: nothing is sent. The notice says what would happen.
      setReportOpen(false);
      setReported(true);
      pendingFocus.current = "reported";
      return { ok: true };
    }
    try {
      await reportMember({ profileId: profile.profileId, reason, details }, reportToken);
      setReportOpen(false);
      setReported(true);
      pendingFocus.current = "reported";
      return { ok: true };
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: REPORT_RATE_LIMITED, fallback: REPORT_ERROR });
      if (mapped.kind === "unavailable") {
        setReportOpen(false);
        live.onGone();
        return { ok: false, gone: true };
      }
      if (mapped.kind === "session") return { ok: false, session: true };
      if (mapped.kind === "field") {
        const { reason: reasonError, details: detailsError } = mapped.fields;
        return reasonError || detailsError
          ? { ok: false, fieldErrors: { reason: reasonError, details: detailsError } }
          : { ok: false, message: REPORT_ERROR };
      }
      return { ok: false, message: errorText(mapped, REPORT_ERROR) };
    }
  }

  const conversationId = sent?.conversationId ?? profile.conversationId;

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <MemberAvatar
          name={name}
          url={profile.hasAvatar ? profile.avatarUrl : undefined}
          getToken={live?.getToken}
          size="lg"
        />
        <div className="flex min-w-0 flex-col gap-4">
          <Strap label="Member" rule={false} />
          <h1 ref={headingRef} tabIndex={-1} className="display-lg break-words outline-offset-2">
            {name}
          </h1>
          {!live && <DemoNotice>A fictional member, made up for this demo.</DemoNotice>}
          {profile.isYou && (
            <Notice>
              This is how members see you.{" "}
              <Link href="/account#member-profile" className="underline underline-offset-4 hover:decoration-2">
                Edit your profile
              </Link>
            </Notice>
          )}
          {profile.bio && (
            <p className="max-w-2xl whitespace-pre-line break-words text-base leading-relaxed sm:text-lg">{profile.bio}</p>
          )}
          {profile.instagramUrl && profile.instagramHandle && (
            <a
              href={profile.instagramUrl}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="inline-flex min-h-11 w-fit items-center gap-1 text-sm break-all underline underline-offset-4 hover:decoration-2"
            >
              {/* One inline span, with the space outside the hidden suffix, so the name keeps it. */}
              <span>
                @{profile.instagramHandle} on Instagram <span className="sr-only">(opens in a new tab)</span>
              </span>
              <span aria-hidden="true">&nbsp;↗</span>
            </a>
          )}
        </div>
      </header>

      {!profile.isYou && (
        <section aria-labelledby="member-actions-title" className="flex flex-col gap-4 border-t border-foreground pt-5">
          <h2 id="member-actions-title" className="sr-only">
            Message, block or report
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {conversationId ? (
              <ButtonLink href={threadHref(conversationId)} variant="solid" size="lg" className="w-full sm:w-auto">
                {!live ? "Message" : sent ? "View conversation" : "Open your conversation"}
              </ButtonLink>
            ) : profile.canMessage ? (
              <Button
                id="member-compose-open"
                variant="solid"
                size="lg"
                aria-expanded={composing}
                aria-controls={composing ? "member-compose" : undefined}
                onClick={() => setComposing((open) => !open)}
                className="w-full sm:w-auto"
              >
                Message
              </Button>
            ) : null}
            <Button
              id="member-block-open"
              variant="outline"
              size="lg"
              aria-expanded={confirmingBlock}
              onClick={() => {
                setActionError(null);
                setConfirmingBlock((open) => !open);
                pendingFocus.current = confirmingBlock ? null : "block-cancel";
              }}
              className="w-full sm:w-auto"
            >
              Block
            </Button>
            <Button variant="outline" size="lg" onClick={() => setReportOpen(true)} className="w-full sm:w-auto">
              Report
            </Button>
          </div>

          {!conversationId && !profile.canMessage && (
            <p className="text-sm text-muted">
              You can message {name} when you&rsquo;re both on the same event&rsquo;s Who&rsquo;s Going list.
            </p>
          )}

          {sent && (
            <p ref={sentRef} tabIndex={-1} className="text-sm leading-5 outline-offset-2">
              Request sent to {name}.{" "}
              <Link href={threadHref(sent.conversationId)} className={tallInlineLinkClass}>
                View conversation
              </Link>
            </p>
          )}

          {composing && !conversationId && live && (
            <div className="rounded-card border border-foreground bg-card p-4 sm:p-5">
              <ComposeRequestForm
                id="member-compose"
                name={name}
                to={{ profileId: profile.profileId }}
                returnTo={returnTo}
                onCancel={() => {
                  setComposing(false);
                  pendingFocus.current = "compose-open";
                }}
                onSent={(conversation) => {
                  setSent(conversation);
                  setComposing(false);
                  pendingFocus.current = "sent";
                }}
              />
            </div>
          )}

          {confirmingBlock && (
            <div
              role="group"
              aria-labelledby="member-block-text"
              className="flex flex-col gap-3 rounded-card border border-foreground bg-card p-4"
            >
              <p id="member-block-text" className="text-sm font-semibold">
                Block {name}?
              </p>
              <p className="text-sm leading-5">
                {BLOCK_EFFECT} You also won&rsquo;t see each other&rsquo;s profiles or appear on each other&rsquo;s
                Who&rsquo;s Going lists. You can unblock them later.
              </p>
              {!live && <DemoNotice>Blocking isn&rsquo;t available in this demo, so nothing changes.</DemoNotice>}
              <div className="flex flex-col gap-3 sm:flex-row">
                {live && (
                  <Button variant="danger" size="lg" busy={blockBusy} onClick={block} className="w-full sm:w-auto">
                    {blockBusy ? "Blocking…" : "Yes, block"}
                  </Button>
                )}
                <Button
                  id="member-block-cancel"
                  variant="outline"
                  size="lg"
                  busy={blockBusy}
                  onClick={() => {
                    setConfirmingBlock(false);
                    setActionError(null);
                    pendingFocus.current = "block-open";
                  }}
                  className="w-full sm:w-auto"
                >
                  {live ? "Cancel" : "Close"}
                </Button>
              </div>
            </div>
          )}

          {actionError && <ActionErrorNotice message={actionError} returnTo={returnTo} />}

          {reported && (
            <div ref={reportedRef} tabIndex={-1} className="outline-offset-2">
              {live ? (
                <Notice>Thanks. Your report has been sent and our team will review it. We won&rsquo;t tell {name}.</Notice>
              ) : (
                <DemoNotice>
                  On the live site, our team would review your report, and we wouldn&rsquo;t tell {endSentence(name)} Nothing was
                  sent in this demo.
                </DemoNotice>
              )}
            </div>
          )}

          <ReportDialog
            open={reportOpen}
            otherName={name}
            subject="profile"
            onClose={() => setReportOpen(false)}
            onSubmit={report}
            returnTo={returnTo}
          />
        </section>
      )}

      <section aria-labelledby="member-events">
        <SectionHead id="member-events" title={profile.isYou ? "Events you’re going to" : `Events ${name} is going to`} />
        {events.length > 0 ? (
          <ul className={RESULTS_GRID}>
            {events.map((event) => (
              <li key={event.id} className="flex min-w-0">
                <EventCard event={event} variant="grid" />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No upcoming events shown" mark={false} />
        )}
      </section>
    </div>
  );
}
