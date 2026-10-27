"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError, type GetToken } from "@/lib/api/client";
import { deleteMyProfile } from "@/lib/api/profiles";
import { SessionExpiredError } from "@/lib/auth/AuthContext";

const RETURN_TO = "/account";

function errorMessage(err: unknown) {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  return "Couldn't delete your profile. Try again.";
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-5 shrink-0 motion-safe:transition-transform motion-safe:duration-150 ${open ? "rotate-180" : ""}`.trim()}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * "Delete your profile" at the foot of /account: a disclosure (a heading
 * holding a 48px button with `aria-expanded`), closed at first, in danger
 * red. Open, it says what goes, then Delete profile asks to confirm inline:
 * opening the confirm focuses its safe choice (Cancel), cancelling returns
 * focus to Delete profile, and a failure keeps focus on Yes, delete to retry.
 */
export default function DeleteProfile({ getToken, onDeleted }: { getToken: GetToken; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  // Applied after the swap has rendered.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    // Consumed only once the target exists: the mount's effect can still be
    // pending when the first click sets it, and would otherwise use it up.
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  }, [confirming]);

  async function confirmDelete() {
    if (deleting) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteMyProfile(getToken);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <div>
      <h2 className="font-heading text-xl leading-6">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center justify-between gap-4 text-left text-danger"
        >
          Delete your profile
          <ChevronDownIcon open={open} />
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="flex flex-col items-start gap-4 pt-2">
        <p className="text-sm">
          Removes your display name and member profile (bio, Instagram and photo), takes you off every event&rsquo;s
          Who&rsquo;s Going list and deletes your conversations, for you and the people you were talking to. Your
          tickets and account aren&rsquo;t affected.
        </p>
        {confirming ? (
          <div role="group" aria-labelledby="delete-confirm-text" className="flex w-full flex-col gap-3">
            <p id="delete-confirm-text" className="text-sm font-semibold">
              Delete your Who&rsquo;s Going profile?
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {/* busy, not disabled: after a failure focus is still here to retry. */}
              <Button variant="danger" size="lg" busy={deleting} onClick={confirmDelete} className="w-full sm:w-auto">
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
              <Button
                id="delete-profile-cancel"
                variant="outline"
                size="lg"
                busy={deleting}
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                  pendingFocus.current = "delete-profile";
                }}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            id="delete-profile"
            variant="danger"
            size="lg"
            onClick={() => {
              setConfirming(true);
              pendingFocus.current = "delete-profile-cancel";
            }}
            className="w-full sm:w-auto"
          >
            Delete profile
          </Button>
        )}
        {error && <ActionErrorNotice message={error} returnTo={RETURN_TO} />}
      </div>
    </div>
  );
}
