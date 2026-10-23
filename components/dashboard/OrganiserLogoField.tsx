"use client";

import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button, buttonClass } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { deleteOrganiserLogo, uploadOrganiserLogo } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { ImageError, prepareEventImage } from "@/lib/image";

/** What the API takes (docs/architecture.md, "Organiser profiles" → Logo: sniffed from the bytes). */
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const RETURN_TO = "/dashboard/profile";

const TOO_LARGE = "That image is over 2 MB, even after shrinking it. Choose a smaller one.";

/** Checked before anything is sent; the server checks again (and decides by the bytes, not the name). */
export function logoFileError(file: File): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (file.size === 0) return "That file is empty. Choose another image.";
  return null;
}

/** What to say when an upload or removal fails: plain words for each of the API's answers. */
export function logoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ImageError) return err.message;
  if (!(err instanceof ApiError)) return fallback;
  switch (err.status) {
    case 401:
      return SESSION_EXPIRED_MESSAGE; // The token was refused: trying again won't help, signing in will.
    case 0:
      return err.message; // No connection: the client's own wording.
    case 400:
      return err.fieldErrors?.logo ?? "We couldn’t use that file. Choose a JPEG, PNG or WebP image.";
    case 403:
      return "Only approved organisers can add a logo. Reload the page to check your profile’s status.";
    case 404:
      return "We couldn’t find your organiser profile. Reload the page and try again.";
    case 409:
      return "Your organiser profile changed while the logo was uploading, so it wasn’t saved. Reload the page to check its status.";
    case 413:
      return TOO_LARGE;
    case 429:
      return "You’ve changed your logo a lot today. Try again tomorrow.";
    case 503:
      return "We’re busy processing images right now. Try again in a minute.";
    default:
      return fallback;
  }
}

type Busy = { kind: "upload"; preview: string } | { kind: "remove" } | null;

/**
 * An approved organiser's logo, saved as soon as it's chosen (no review,
 * like the bio): a preview (the stored logo, or a placeholder), a file picker
 * styled as a button (the native input, visually hidden but focusable) and
 * Remove. A chosen image is checked, shrunk in the browser (lib/image.ts: at
 * most 1600 px and 2 MB), shown at once as a preview while it uploads, then
 * replaced by what the server stored (the whole image fitted on a white
 * square, with no metadata). The logo is public, so the stored one is a
 * plain image. Upload progress isn't measurable through the API client, so
 * "Uploading…" is said, not a percentage.
 */
export default function OrganiserLogoField({
  organiser,
  getToken,
}: {
  organiser: OrganiserRecord;
  getToken: GetToken;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(organiser.logoUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
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
    setStatus("");
    const invalid = logoFileError(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy({ kind: "upload", preview: URL.createObjectURL(file) });
    setStatus("Uploading your logo…");
    try {
      const image = await prepareEventImage(file);
      const updated = await uploadOrganiserLogo(image, getToken);
      setLogoUrl(updated.logoUrl);
      setStatus("Logo saved. It’s on your public profile now.");
    } catch (err) {
      setError(logoErrorMessage(err, "Couldn’t upload that logo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setError(null);
    setBusy({ kind: "remove" });
    setStatus("Removing your logo…");
    try {
      const updated = await deleteOrganiserLogo(getToken);
      setLogoUrl(updated.logoUrl);
      setStatus("Logo removed.");
      // The Remove button has gone: focus goes back to the picker.
      inputRef.current?.focus();
    } catch (err) {
      setError(logoErrorMessage(err, "Couldn’t remove your logo. Try again."));
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  const hasLogo = Boolean(logoUrl);
  const loadFailed = Boolean(logoUrl) && failedUrl === logoUrl;

  return (
    <div data-organiser-logo-field="" className="flex flex-col gap-3" aria-busy={busy ? true : undefined}>
      <p id="organiser-logo-title" className="eyebrow text-muted">
        Logo (optional)
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-dot border border-foreground bg-paper sm:size-32">
          {busy?.kind === "upload" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview of the chosen file
            <img src={busy.preview} alt="Your new logo, uploading" className="size-full object-contain opacity-60" />
          ) : logoUrl && !loadFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image (512 px, versioned)
            <img
              src={logoUrl}
              alt="Your logo"
              width={128}
              height={128}
              decoding="async"
              onError={() => setFailedUrl(logoUrl)}
              className="size-full object-contain"
            />
          ) : (
            // Not the logo itself (that's always on white): a token placeholder for either theme.
            <span className="flex size-full items-center justify-center bg-surface px-2 text-center text-xs text-muted">
              {loadFailed ? "Couldn’t show your logo" : "No logo yet"}
            </span>
          )}
        </div>
        <div className="flex flex-col items-start gap-3">
          <input
            ref={inputRef}
            id="organiser-logo"
            type="file"
            accept={LOGO_TYPES.join(",")}
            // Not disabled while busy (that would drop focus from it): a pick then is ignored.
            aria-disabled={busy ? true : undefined}
            onChange={(e) => pick(e.target.files?.[0])}
            aria-labelledby="organiser-logo-title organiser-logo-pick"
            aria-describedby="organiser-logo-hint"
            className="peer sr-only"
          />
          <label
            id="organiser-logo-pick"
            htmlFor="organiser-logo"
            className={buttonClass(
              "outline",
              "md",
              `min-h-11 cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-foreground ${
                busy ? "pointer-events-none border-surface-border bg-surface text-muted" : ""
              }`,
            )}
          >
            {hasLogo ? "Change logo" : "Choose a logo"}
          </label>
          <p id="organiser-logo-hint" className="max-w-sm text-xs text-muted">
            JPEG, PNG or WebP, saved as soon as you choose it. It&rsquo;s public: on your profile and beside your
            name on your event pages. We fit the whole image on a white square, so a square logo fills it best,
            and remove everything stored in the file (such as camera and location details). Only upload a logo
            you have the rights to use.
          </p>
          {busy?.kind === "upload" && <DotsLoader label="Uploading" />}
          {hasLogo && busy?.kind !== "upload" && (
            <Button variant="outline" size="md" busy={busy?.kind === "remove"} onClick={remove} className="min-h-11">
              {busy?.kind === "remove" ? "Removing…" : "Remove logo"}
            </Button>
          )}
        </div>
      </div>
      {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}
