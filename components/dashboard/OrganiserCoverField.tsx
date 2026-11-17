"use client";

import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { LOGO_TYPES, logoErrorMessage, logoFileError } from "@/components/dashboard/organiser-image-upload";
import { Button, buttonClass } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { ApiError, type GetToken } from "@/lib/api/client";
import { deleteOrganiserCover, uploadOrganiserCover } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { COVER_WIDTH_PX, prepareCoverImage } from "@/lib/image";

const RETURN_TO = "/dashboard/profile";
const countFormatter = new Intl.NumberFormat("en-AU");

/**
 * What to say when a cover upload or removal fails: the logo's words
 * (logoErrorMessage) where they're the same, the cover's own otherwise.
 */
export function coverErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
        return err.fieldErrors?.cover ?? "We couldn’t use that file. Choose a JPEG, PNG or WebP image.";
      case 403:
        return "Only approved organisers can add a cover photo. Reload the page to check your profile’s status.";
      case 409:
        return "Your organiser profile changed while the cover photo was uploading, so it wasn’t saved. Reload the page to check its status.";
      case 413:
        return "That image is over 4 MB, even after shrinking it. Choose a smaller one.";
      case 429:
        return "You’ve changed your cover photo a lot today. Try again tomorrow.";
    }
  }
  return logoErrorMessage(err, fallback);
}

/** The warning after saving a cover narrower than the stored 2240 px (it's enlarged, so it may look soft). */
export function narrowCoverWarning(width: number): string {
  return `Saved. This photo is ${countFormatter.format(width)} px wide where we crop it, so it’s enlarged to ${countFormatter.format(
    COVER_WIDTH_PX,
  )} px and may look soft on large screens. For a sharper cover, choose one at least ${countFormatter.format(COVER_WIDTH_PX)} px wide.`;
}

type Busy = { kind: "upload"; preview: string } | { kind: "remove" } | null;

/**
 * An approved organiser's cover photo (docs/design/organiser-profile.md
 * §5.8), saved as soon as it's chosen, like the logo (OrganiserLogoField): a
 * 7:2 preview (the stored cover, the chosen one while it uploads, or a
 * placeholder) shaded at the sides where a 320px phone crops it, a file
 * picker styled as a button and Remove. The chosen image is cropped in the
 * browser as the server will (lib/image.ts prepareCoverImage); if its crop is
 * narrower than 2240 px, a note after saving says it's been enlarged.
 */
export default function OrganiserCoverField({
  organiser,
  getToken,
}: {
  organiser: OrganiserRecord;
  getToken: GetToken;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState({ url: organiser.coverUrl, smallUrl: organiser.coverSmallUrl });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [narrowWidth, setNarrowWidth] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  // The local preview of a chosen image is an object URL: revoke it when it's replaced.
  const preview = busy?.kind === "upload" ? busy.preview : null;
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function pick(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file || busy) return;
    setError(null);
    setNarrowWidth(null);
    setStatus("");
    const invalid = logoFileError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy({ kind: "upload", preview: URL.createObjectURL(file) });
    setStatus("Uploading your cover photo…");
    try {
      const prepared = await prepareCoverImage(file);
      const updated = await uploadOrganiserCover(prepared.image, getToken);
      setCover({ url: updated.coverUrl, smallUrl: updated.coverSmallUrl });
      const narrow = prepared.width !== null && prepared.width < COVER_WIDTH_PX ? prepared.width : null;
      setNarrowWidth(narrow);
      setStatus(
        `Cover photo saved. It’s on your public profile now.${
          narrow === null ? "" : " It’s been enlarged, so it may look soft on large screens."
        }`,
      );
    } catch (err) {
      setError(coverErrorMessage(err, "Couldn’t upload that cover photo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setError(null);
    setNarrowWidth(null);
    setBusy({ kind: "remove" });
    setStatus("Removing your cover photo…");
    try {
      const updated = await deleteOrganiserCover(getToken);
      setCover({ url: updated.coverUrl, smallUrl: updated.coverSmallUrl });
      setStatus("Cover photo removed.");
      // The Remove button has gone: focus goes back to the picker.
      inputRef.current?.focus();
    } catch (err) {
      setError(coverErrorMessage(err, "Couldn’t remove your cover photo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  const shownUrl = cover.smallUrl ?? cover.url;
  const hasCover = Boolean(cover.url);
  const loadFailed = Boolean(shownUrl) && failedUrl === shownUrl;
  const showsImage = busy?.kind === "upload" || (Boolean(shownUrl) && !loadFailed);

  return (
    <div id="cover" data-organiser-cover-field="" className="flex flex-col gap-3">
      {/* Busy while it uploads or removes; the status line is outside it, so its progress is still announced. */}
      <div data-organiser-cover-body="" className="flex flex-col gap-3" aria-busy={busy ? true : undefined}>
        <p id="organiser-cover-title" className="eyebrow text-muted">
          Cover photo (optional)
        </p>
        <div className="relative aspect-7/2 w-full max-w-2xl overflow-hidden rounded-card bg-surface">
          {busy?.kind === "upload" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen file
            <img
              src={busy.preview}
              alt="Your new cover photo, uploading"
              className="size-full object-cover object-center opacity-60"
            />
          ) : shownUrl && !loadFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image (1120 px, versioned)
            <img
              src={shownUrl}
              alt="Your cover photo"
              width={1120}
              height={320}
              decoding="async"
              onError={() => setFailedUrl(shownUrl)}
              className="size-full object-cover object-center"
            />
          ) : (
            <span className="flex size-full items-center justify-center px-2 text-center text-xs text-muted">
              {loadFailed ? "Couldn’t show your cover photo" : "No cover photo yet"}
            </span>
          )}
          {showsImage && (
            // What a 320px phone crops away at each side (it keeps the middle 47%).
            <>
              <span aria-hidden="true" data-phone-crop="" className="absolute inset-y-0 left-0 w-[26.5%] bg-ink/50" />
              <span aria-hidden="true" data-phone-crop="" className="absolute inset-y-0 right-0 w-[26.5%] bg-ink/50" />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id="organiser-cover"
            type="file"
            accept={LOGO_TYPES.join(",")}
            // Not disabled while busy (that would drop focus from it): a pick then is ignored.
            aria-disabled={busy ? true : undefined}
            onChange={(e) => pick(e.target.files?.[0])}
            aria-labelledby="organiser-cover-title organiser-cover-pick"
            aria-describedby="organiser-cover-hint"
            className="peer sr-only"
          />
          <label
            id="organiser-cover-pick"
            htmlFor="organiser-cover"
            className={buttonClass(
              "outline",
              "md",
              `min-h-11 cursor-pointer max-sm:w-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground ${
                busy ? "pointer-events-none border-surface-border bg-surface text-muted" : ""
              }`,
            )}
          >
            {hasCover ? "Change cover photo" : "Choose a cover photo"}
          </label>
          {hasCover && busy?.kind !== "upload" && (
            <Button
              variant="outline"
              size="md"
              busy={busy?.kind === "remove"}
              onClick={remove}
              className="min-h-11 max-sm:w-full"
            >
              {busy?.kind === "remove" ? "Removing…" : "Remove cover photo"}
            </Button>
          )}
        </div>
        <p id="organiser-cover-hint" className="max-w-xl text-xs text-muted">
          JPEG, PNG or WebP, cropped to a wide 7:2 strip. 2240 &times; 640 px or larger looks sharpest; phones show the
          clear middle. Only upload a photo you have the rights to use.
        </p>
        {busy?.kind === "upload" && <DotsLoader label="Uploading" />}
        {narrowWidth !== null && <Notice tone="info">{narrowCoverWarning(narrowWidth)}</Notice>}
        {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
