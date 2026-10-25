"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import AuthField, { fieldsForAuthError, useFocusAfterRender } from "@/components/auth/AuthField";
import LegalNote from "@/components/auth/LegalNote";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import { acceptInvite, getInviteAccountLink, getMyInvite } from "@/lib/api/invites";
import type { AcceptInviteResult, MyInvite } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { PASSWORD_HINT, PASSWORD_REGEX } from "@/lib/auth/password-rules";
import { withNext } from "@/lib/safe-next-path";
import { apiErrorCode, inviteProblem, type InviteProblem } from "./invite-problems";

const FORM_ERROR_ID = "invite-account-error";
export const INVITE_PATH = "/invite";

type Field = "password" | "confirmPassword";

/** What "Create account" ended in, once the account exists and is signed in. */
export interface InviteAccountCreated {
  /** The invite waiting for the new account's address; null if it couldn't be loaded (the page loads it again). */
  invite: MyInvite | null;
  /** A member invite, accepted straight away. */
  accepted: AcceptInviteResult | null;
  /** Why accepting a member invite straight away failed: shown on the Accept step. */
  acceptError: string | null;
}

/** What Supabase's verify said, in our words: "otp_expired" is a sign-up token that has run out or was used. */
export function verifyErrorText(err: unknown): string {
  const code = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
  if (code === "otp_expired") {
    return "The sign-up link we made for you expired before it could be used. Press Create account to try again.";
  }
  return "We couldn’t confirm your account just now. Press Create account to try again.";
}

/**
 * An invite's "Create account" with a password (docs/architecture.md,
 * "Account invites"): POST /api/invites/account-link for a sign-up token
 * hash, verifyInvite (which confirms the address and signs in), then
 * setNewPassword (which signs out any other session). Then the invite for
 * the address: a member invite is accepted straight away; an organiser
 * invite goes on to its Join step. Once verified, a retry only sets the
 * password (the account exists by then).
 *
 * The address is the invite's, so it isn't asked for; the person only
 * chooses a password, with the sign-up rules.
 */
export default function InviteCreateAccount({
  token,
  maskedEmail,
  onBegin,
  onIdle,
  onCreated,
  onHasAccount,
  onUnavailable,
  onProblem,
}: {
  token: string;
  maskedEmail: string;
  /** Pressed: from here the page keeps this form on screen, even as the new account signs in. */
  onBegin: () => void;
  /** It stopped short of creating the account (still signed out): the page needn't keep the form on screen. */
  onIdle: () => void;
  onCreated: (result: InviteAccountCreated) => void;
  /** The address has an account by now: sign in instead. */
  onHasAccount: (message: string) => void;
  /** Accounts can't be set up from here: the ordinary sign-up instead. */
  onUnavailable: (message: string) => void;
  /** The link can't be used (invalid, expired, withdrawn, used). */
  onProblem: (problem: InviteProblem) => void;
}) {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  // The account exists and is signed in; only its password is still to set.
  const [verified, setVerified] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useFocusAfterRender();

  function validate(): Partial<Record<Field, string>> {
    const errors: Partial<Record<Field, string>> = {};
    if (!password) errors.password = "Choose a password";
    else if (!PASSWORD_REGEX.test(password)) errors.password = "Password doesn't meet the requirements.";
    if (!confirmPassword) errors.confirmPassword = "Confirm your password";
    else if (password && password !== confirmPassword) errors.confirmPassword = "Passwords don't match.";
    return errors;
  }

  /** A sign-up token hash for the invite's address, or null when the page has moved on (or said why not). */
  async function requestLink(): Promise<string | null> {
    try {
      return (await getInviteAccountLink(token)).tokenHash;
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === "has_account" && err instanceof ApiError) {
        onHasAccount(err.message);
        return null;
      }
      if (err instanceof ApiError && (code === "unavailable" || err.status === 503)) {
        onUnavailable(err.message);
        return null;
      }
      const problem = inviteProblem(err, "set up your account");
      if (problem.reason !== "failed") onProblem(problem);
      else setError(problem.message);
      return null;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setPasswordInvalid(false);
    const errors = validate();
    setFieldErrors(errors);
    if (errors.password || errors.confirmPassword) {
      focusAfterRender(errors.password ? passwordRef.current : confirmRef.current);
      return;
    }

    setBusy(true);
    onBegin();
    let signedIn = verified;
    try {
      if (!verified) {
        const tokenHash = await requestLink();
        if (!tokenHash) return;
        try {
          await auth.verifyInvite(tokenHash);
        } catch (err) {
          setError(verifyErrorText(err));
          return;
        }
        signedIn = true;
        setVerified(true);
      }

      try {
        await auth.setNewPassword(password);
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "Try again.";
        setError(`Your account is set up, but its password wasn’t saved: ${message}`);
        if (fieldsForAuthError(message, ["password"]).includes("password")) {
          setPasswordInvalid(true);
          focusAfterRender(passwordRef.current);
        }
        return;
      }

      // Signed in with a password: the invite waiting for this address.
      let invite: MyInvite;
      try {
        invite = await getMyInvite(auth.getAccessToken);
      } catch {
        // The page asks again now that it's signed in, and says what went wrong if it still can't.
        onCreated({ invite: null, accepted: null, acceptError: null });
        return;
      }
      if (invite.kind !== "member") {
        onCreated({ invite, accepted: null, acceptError: null });
        return;
      }
      try {
        onCreated({ invite, accepted: await acceptInvite(invite.inviteId, auth.getAccessToken), acceptError: null });
      } catch (err) {
        onCreated({
          invite,
          accepted: null,
          acceptError: err instanceof Error && err.message ? err.message : "Couldn’t accept the invite.",
        });
      }
    } finally {
      setBusy(false);
      if (!signedIn) onIdle();
    }
  }

  const label = verified ? "Save password" : "Create account";
  const busyLabel = verified ? "Saving password…" : "Creating account…";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate aria-label="Create your account">
      <p className="text-sm text-foreground">
        <span className="eyebrow mr-2 text-muted">Email</span>
        <span className="break-all">{maskedEmail}</span>
      </p>
      <AuthField
        ref={passwordRef}
        id="invite-password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        invalidBy={passwordInvalid ? FORM_ERROR_ID : undefined}
        hint={PASSWORD_HINT}
      />
      <AuthField
        ref={confirmRef}
        id="invite-confirm-password"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        error={fieldErrors.confirmPassword}
      />

      {/* Always rendered, so a message added to it is read out. */}
      <div role="alert">
        {error && (
          <p id={FORM_ERROR_ID} className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <LegalNote />

      <Button type="submit" size="lg" busy={busy} className="w-full">
        {busy ? busyLabel : label}
      </Button>
      <p role="status" className="sr-only">
        {busy ? "Setting up your account…" : ""}
      </p>

      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href={withNext("/login", INVITE_PATH)} className="text-accent underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
