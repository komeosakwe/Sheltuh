"use client";

import type { Ref } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { PUBLISH_REVIEW_GENERAL, PUBLISH_REVIEW_REASON_TEXT, type PublishReviewReason } from "@/lib/organiser-events";

export const PUBLISH_CONFIRM_ID = "publish-confirm";
export const PUBLISH_REFUSAL_ID = "publish-refusal";
export const PUBLISH_OUTCOME_ID = "publish-outcome";

/** What an organiser's publish did (POST /api/events/{id}/publish): it went live, or to the review queue. */
export type PublishOutcome = { kind: "published"; slug: string } | { kind: "review"; reason: PublishReviewReason | null };

/**
 * The question before an organiser publishes (docs: "Approved organisers
 * publish now"): what happens, so it's never a surprise. Going live: at once,
 * followers emailed (which can't be undone), and no editing here afterwards.
 * When it's known to go to review instead (`reason`), it says why and that it
 * goes live once approved. Escape or Cancel closes it (back to Publish…).
 */
export function PublishConfirm({
  reason,
  busy,
  describedBy,
  cancelRef,
  onConfirm,
  onCancel,
}: {
  reason: PublishReviewReason | null;
  busy: boolean;
  /** The payouts hint or refusal, when there is one: the confirm button names it as Publish… did. */
  describedBy: string | undefined;
  cancelRef: Ref<HTMLButtonElement>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const questionId = `${PUBLISH_CONFIRM_ID}-question`;
  const detailsId = `${PUBLISH_CONFIRM_ID}-details`;
  const review = reason !== null;
  return (
    <div
      id={PUBLISH_CONFIRM_ID}
      role="group"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onCancel();
        }
      }}
      className="flex flex-col gap-3 border-l-2 border-foreground py-1 pl-4 text-sm text-foreground"
    >
      <p id={questionId} className="font-semibold">
        {review ? "Send this event for review?" : "Publish this event now?"}
      </p>
      <ul id={detailsId} className="flex list-disc flex-col gap-1 pl-5 text-muted">
        {review ? (
          <>
            <li>{PUBLISH_REVIEW_REASON_TEXT[reason]}</li>
            <li>It goes live once it&rsquo;s approved, and your followers are emailed then.</li>
            <li>You can&rsquo;t edit it while it&rsquo;s waiting.</li>
          </>
        ) : (
          <>
            <li>It goes live on Sheltüh straight away, with the changes on screen (they&rsquo;re saved first).</li>
            <li>Your followers are emailed about it. Emails can&rsquo;t be unsent.</li>
            <li>You can&rsquo;t edit it here afterwards. To change it, you&rsquo;d contact Sheltüh.</li>
          </>
        )}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="solid"
          busy={busy}
          onClick={onConfirm}
          aria-describedby={[detailsId, describedBy].filter(Boolean).join(" ")}
          className="min-h-11 w-fit"
        >
          {busy ? (review ? "Sending…" : "Publishing…") : review ? "Send for review" : "Publish now"}
        </Button>
        <Button ref={cancelRef} variant="outline" busy={busy} onClick={onCancel} className="min-h-11 w-fit">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * What the publish did, in place of the form (now locked), focused so it's
 * read: live (with its public page), or sent for review and why
 * (lib/organiser-events.ts; the general reason when it isn't known here).
 */
export function PublishOutcomeView({ outcome, ref }: { outcome: PublishOutcome; ref: Ref<HTMLDivElement> }) {
  const titleId = `${PUBLISH_OUTCOME_ID}-title`;
  const textId = `${PUBLISH_OUTCOME_ID}-text`;
  const published = outcome.kind === "published";
  return (
    <div
      ref={ref}
      id={PUBLISH_OUTCOME_ID}
      tabIndex={-1}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={textId}
      data-publish-outcome={outcome.kind}
      className="flex flex-col items-start gap-3 rounded-card border border-foreground bg-card p-4 text-foreground outline-offset-2 sm:p-5"
    >
      <h2 id={titleId} className="font-heading text-xl">
        {published ? "Published" : "Sent for review"}
      </h2>
      {published ? (
        <>
          <p id={textId} className="text-sm">
            It&rsquo;s live on Sheltüh now, and your followers are being emailed about it.
          </p>
          <ButtonLink href={`/events/${encodeURIComponent(outcome.slug)}`} variant="solid" className="min-h-11 w-fit">
            View your event page
          </ButtonLink>
          <p className="text-sm text-muted">
            It can&rsquo;t be edited here now. To change something,{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline underline-offset-2">
              contact Sheltüh
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p id={textId} className="text-sm">
            {outcome.reason ? PUBLISH_REVIEW_REASON_TEXT[outcome.reason] : PUBLISH_REVIEW_GENERAL}
          </p>
          <p className="text-sm text-muted">
            It goes live once it&rsquo;s approved, and your followers are emailed then. You can&rsquo;t edit it
            while it&rsquo;s waiting.
          </p>
        </>
      )}
    </div>
  );
}
