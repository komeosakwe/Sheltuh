"use client";

import { Fragment, useId, useState } from "react";
import AnalyticsGate from "@/components/analytics/AnalyticsGate";
import { Button } from "@/components/ui/Button";
import { SIGN_PAGE_CSS, SIGN_PAPER_LABEL, SIGN_PAPERS, signSummary, signText, type SignPaper } from "@/lib/qr-sign";
import { eventQrSignHref } from "@/lib/organiser-nav";
import EventQrFrame from "./EventQrFrame";
import EventQrSign from "./EventQrSign";
import { useEventQr, type EventQrState } from "./useEventQr";

/**
 * /dashboard/events/[id]/qr/sign: the event's QR code as a ready-made sign
 * to print or save as a PDF, on A4 or A5. The preview is the page itself; the
 * browser's print dialog does the rest ("Save as PDF" is one of its
 * printers), so there's no PDF library and nothing to download first.
 * Printing shows only the sheet (globals.css, `[data-print-sheet]`), at the
 * chosen paper's size with no margin (SIGN_PAGE_CSS).
 */
export default function EventQrSignPage({ eventId }: { eventId: string }) {
  return (
    <AnalyticsGate title="Printable sign" returnTo={eventQrSignHref(eventId)} signInTitle="Sign in to get your QR code" need="get a QR code">
      {() => <SignPage eventId={eventId} />}
    </AnalyticsGate>
  );
}

/** The gate has made sure the viewer is an approved organiser; the hook reads their account itself. */
function SignPage({ eventId }: { eventId: string }) {
  const { state, retry } = useEventQr(eventId);
  return (
    <EventQrFrame eventId={eventId} from="sign" title="Printable sign" state={state} retry={retry}>
      {(ready) => <SignReady ready={ready} />}
    </EventQrFrame>
  );
}

/** Waits for the page's fonts (the title's display face), so the print never falls back to another face. */
async function printWhenFontsReady() {
  if ("fonts" in document) await document.fonts.ready;
  window.print();
}

function SignReady({ ready }: { ready: Extract<EventQrState, { status: "ready" }> }) {
  const [paper, setPaper] = useState<SignPaper>("a4");
  const name = useId();
  const hintId = useId();
  const text = signText(ready.event, ready.url);

  return (
    // The controls, the proofreading line and the preview share the sheet's width (`qr-sign-column`), so they line up.
    <div className="qr-sign-column flex flex-col gap-6" data-paper={paper}>
      {/* The chosen paper's print page (constant CSS, never built from the event). */}
      <style>{SIGN_PAGE_CSS[paper]}</style>
      <div className="flex flex-col flex-wrap gap-4 md:flex-row md:items-end md:justify-between">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="eyebrow mb-2 text-muted">Paper size</legend>
          <div className="flex flex-wrap gap-2">
            {SIGN_PAPERS.map((option) => (
              <label
                key={option}
                className="flex min-h-11 min-w-20 cursor-pointer items-center gap-2 rounded-control border-control border-foreground px-4 text-sm font-semibold has-[:checked]:bg-surface"
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={paper === option}
                  onChange={() => setPaper(option)}
                  className="size-5 shrink-0"
                />
                {SIGN_PAPER_LABEL[option]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <Button className="min-h-11" aria-describedby={hintId} onClick={() => void printWhenFontsReady()}>
            Print or save as PDF
          </Button>
          <p id={hintId} className="text-sm leading-5 text-muted md:text-right">
            Choose {SIGN_PAPER_LABEL[paper]} paper, portrait, at 100%.
          </p>
        </div>
      </div>
      {/* The sheet's details as text, for proofreading where the preview is small (a phone). */}
      <p className="text-sm leading-5 break-words">
        <span className="font-semibold">The sign says:</span>{" "}
        {signSummary(text).map((part, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <>
                {/* A dot for the eye, a comma for a screen reader (which would read "dot" or nothing). */}
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
              </>
            )}
            {part}
          </Fragment>
        ))}
      </p>
      <div className="flex justify-center">
        <EventQrSign text={text} matrix={ready.matrix} paper={paper} />
      </div>
    </div>
  );
}
