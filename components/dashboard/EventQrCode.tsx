"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AnalyticsGate from "@/components/analytics/AnalyticsGate";
import { saveBlob } from "@/components/analytics/ExportCsvButton";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { QR_TRACKING_LABEL } from "@/lib/api/analytics";
import { MAX_TRACKING_LINKS_PER_EVENT } from "@/lib/api/types";
import { displayUrl, eventQrFilename, linkQrSvg } from "@/lib/link-qr";
import { linkQrPngBlob } from "@/lib/link-qr-png";
import { eventQrHref, eventQrSignHref } from "@/lib/organiser-nav";
import EventQrFrame from "./EventQrFrame";
import LinkQrImage from "./LinkQrImage";
import { useEventQr, type EventQrState } from "./useEventQr";

/**
 * /dashboard/events/[id]/qr: a published event's QR code for posters and
 * flyers (docs/architecture.md, "Event QR codes"). It opens the event's page
 * through its "QR code" tracking link, so views from it are counted under
 * that link. Downloads as a PNG (about 2000 px) or an SVG, and as a printable
 * sign. Everything is drawn here in the browser; nothing new is stored but
 * the tracking link.
 */
export default function EventQrCode({ eventId }: { eventId: string }) {
  return (
    <AnalyticsGate title="QR code" returnTo={eventQrHref(eventId)} signInTitle="Sign in to get your QR code" need="get a QR code">
      {() => <QrCodePage eventId={eventId} />}
    </AnalyticsGate>
  );
}

/** The gate has made sure the viewer is an approved organiser; the hook reads their account itself. */
function QrCodePage({ eventId }: { eventId: string }) {
  const { state, retry } = useEventQr(eventId);
  return (
    <EventQrFrame eventId={eventId} from="qr" title="QR code" state={state} retry={retry}>
      {(ready) => <QrCodeReady eventId={eventId} ready={ready} />}
    </EventQrFrame>
  );
}

/** How long the status region stays empty before a download's words are set (see `announce`). */
const ANNOUNCE_DELAY_MS = 100;

function QrCodeReady({ eventId, ready }: { eventId: string; ready: Extract<EventQrState, { status: "ready" }> }) {
  const { event, url, matrix, tracked } = ready;
  const [pngBusy, setPngBusy] = useState(false);
  const [pngError, setPngError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<number | undefined>(undefined);
  const address = displayUrl(url);

  useEffect(() => () => window.clearTimeout(announceTimer.current), []);

  /**
   * Says `message` in the status region. It's emptied first and the words set a moment later, so the same
   * words again (a second download) are a change a screen reader announces, not a no-op.
   */
  function announce(message: string) {
    window.clearTimeout(announceTimer.current);
    setAnnouncement("");
    announceTimer.current = window.setTimeout(() => setAnnouncement(message), ANNOUNCE_DELAY_MS);
  }

  async function downloadPng() {
    setPngBusy(true);
    setPngError(null);
    window.clearTimeout(announceTimer.current);
    setAnnouncement("");
    try {
      saveBlob(await linkQrPngBlob(matrix), eventQrFilename(event.slug, "png"));
      announce("PNG downloaded.");
    } catch {
      setPngError("Couldn’t make the PNG. Try again, or download the SVG.");
    } finally {
      setPngBusy(false);
    }
  }

  function downloadSvg() {
    // The SVG is the way round a PNG that failed: that error no longer applies.
    setPngError(null);
    saveBlob(new Blob([linkQrSvg(matrix)], { type: "image/svg+xml" }), eventQrFilename(event.slug, "svg"));
    announce("SVG downloaded.");
  }

  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
      <div className="w-fit shrink-0 border border-foreground">
        <LinkQrImage matrix={matrix} label={`QR code for ${address}`} className="size-56 sm:size-64" />
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="eyebrow text-muted">Opens</p>
          <p className="text-base leading-6 font-semibold break-all">{address}</p>
          <p className="text-sm leading-5 text-muted">Your event page. It isn’t a ticket, so it won’t get anyone in at the door.</p>
        </div>

        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" busy={pngBusy} onClick={() => void downloadPng()}>
              {pngBusy ? "Preparing…" : "Download PNG"}
            </Button>
            <Button variant="outline" className="min-h-11" onClick={downloadSvg}>
              Download SVG
            </Button>
            <ButtonLink variant="outline" className="min-h-11" href={eventQrSignHref(eventId)}>
              Printable sign
            </ButtonLink>
          </div>
          <p className="text-sm leading-5 text-muted">PNG for posts and screens. SVG for print: it stays sharp at any size.</p>
          {pngError && (
            <Notice tone="danger" role="alert">
              {pngError}
            </Notice>
          )}
          <p role="status" className="sr-only">
            {announcement}
          </p>
        </div>

        {tracked ? (
          <div className="flex flex-col gap-2 border-t border-surface-border pt-4 text-sm leading-5">
            <p>
              Visits from this code show in{" "}
              <Link href={`/dashboard/events/${encodeURIComponent(eventId)}/analytics`} className="font-semibold underline underline-offset-4">
                Analytics
              </Link>{" "}
              under “{QR_TRACKING_LABEL}”. They’re page views, not scans.
            </p>
            <p className="text-muted">
              Keep the “{QR_TRACKING_LABEL}” tracking link. If you delete it, this code stops counting, and you’ll get a different
              code next time.
            </p>
          </div>
        ) : (
          <Notice>
            This code opens your event page directly, so its visits aren’t counted separately. You have{" "}
            {MAX_TRACKING_LINKS_PER_EVENT} tracking links, the most for one event: to get a tracked code, delete one in{" "}
            <Link href={`/dashboard/events/${encodeURIComponent(eventId)}/analytics`} className="font-semibold underline underline-offset-4">
              Analytics
            </Link>
            , then come back.
          </Notice>
        )}
      </div>
    </div>
  );
}
