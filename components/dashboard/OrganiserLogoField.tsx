"use client";

import { useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button, buttonClass } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { deleteOrganiserLogo, uploadOrganiserLogo } from "@/lib/api/organisers";
import type { OrganiserRecord } from "@/lib/api/types";
import { useAccountOwner } from "@/lib/auth/useAccountOwner";
import { prepareEventImage } from "@/lib/image";
import { LOGO_TYPES, logoErrorMessage, logoFileError } from "./organiser-image-upload";

const RETURN_TO = "/dashboard/profile";

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
 * "Uploading…" is said, not a percentage. Requests are made only as the
 * account that was signed in when it mounted (useAccountOwner): if someone
 * else has signed in since (another tab), the upload or removal is refused,
 * never sent as them.
 */
export default function OrganiserLogoField({ organiser }: { organiser: OrganiserRecord }) {
  const { otherAccount, getOwnerToken } = useAccountOwner();
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
    if (otherAccount) {
      // Signed in as someone else now (another tab): refused, never sent as them.
      setError(SESSION_EXPIRED_MESSAGE);
      return;
    }
    setBusy({ kind: "upload", preview: URL.createObjectURL(file) });
    setStatus("Uploading your logo…");
    try {
      const image = await prepareEventImage(file);
      const updated = await uploadOrganiserLogo(image, getOwnerToken);
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
    setStatus("");
    if (otherAccount) {
      // Signed in as someone else now (another tab): refused, never sent as them.
      setError(SESSION_EXPIRED_MESSAGE);
      return;
    }
    setBusy({ kind: "remove" });
    setStatus("Removing your logo…");
    try {
      const updated = await deleteOrganiserLogo(getOwnerToken);
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
    <div id="logo" data-organiser-logo-field="" className="flex flex-col gap-3" aria-busy={busy ? true : undefined}>
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
            JPEG, PNG or WebP, saved when you choose it. It&rsquo;s public, on your profile and event pages. Camera and
            location data is removed. Only upload a logo you have the rights to use.
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
