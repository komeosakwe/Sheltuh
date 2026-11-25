"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import { signInMethodsLabel } from "@/lib/auth/oauth";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { useProfile } from "@/lib/auth/useProfile";
import { withNext } from "@/lib/safe-next-path";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { SUPPORT_EMAIL } from "@/lib/contact";
import AccountLinks, { EVENTS_ROWS, type AccountEventsRow } from "./AccountLinks";
import DeleteProfile from "./DeleteProfile";
import ProfileCard, { cardHeadingClass, DemoProfileCard, settingsCardClass } from "./ProfileCard";

const linkClass = "underline underline-offset-4 hover:decoration-2";
const RETURN_TO = "/account";

/**
 * /account (Settings), as Latte's 1120 Settings frames lay it out: two columns of cards from
 * 768px (stacked on phones). Left: Your profile (photo, display name, bio, Instagram, the
 * visibility switch: one Save) and Privacy (Blocked members, how we handle your information,
 * Delete your profile behind a disclosure). Right: Sign-in (the email and how it signs in, Sign
 * out: the only log-out on tablet and mobile), Events (Your events for organisers, else Organise
 * events; Organisers you follow), and how to delete the whole account. The frames' Notifications
 * card and Personalised picks have nothing behind them yet, so they aren't shown.
 */
export default function AccountContent() {
  const auth = useAuth();
  const router = useRouter();
  const { state, setProfile, reload } = useProfile();
  const organiser = useOrganiser();
  // How this account signs in (Apple's guidelines: show it). Text only, no logos.
  const signInMethods = signInMethodsLabel(auth.providers);
  const [deleted, setDeleted] = useState(false);

  function handleSignOut() {
    auth.signOut();
    router.push("/");
  }

  if (!auth.configured) return <DemoAccount />;
  if (auth.status === "loading") return <LoadingState text="Loading your account…" />;
  if (auth.status === "signed-out") {
    return (
      <EmptyState
        title="Sign in to manage your account"
        action={
          <ButtonLink size="lg" href={withNext("/login", RETURN_TO)}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  // Organisers (any application on file) get Your events. If their status
  // couldn't be loaded, the row stays: the dashboard explains itself. Anyone
  // else gets Organise events, the way to apply.
  const eventsRow: AccountEventsRow = organiser.loading
    ? null
    : organiser.organiser !== null || organiser.error !== null
      ? "events"
      : "apply";
  const profile = state.status === "ready" ? state.profile : null;

  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <ProfileCard
          state={state}
          reload={reload}
          onSaved={setProfile}
          getToken={auth.getAccessToken}
          returnTo={RETURN_TO}
          deleted={deleted}
        />

        <section className={settingsCardClass} aria-labelledby="privacy-title">
          <h2 id="privacy-title" className={cardHeadingClass}>
            Privacy
          </h2>
          <AccountLinks
            label="Privacy"
            links={[
              { href: "/messages/blocked", label: "Blocked members", note: "People who can’t message you" },
              { href: "/privacy#whos-going", label: "How we handle your information", note: "Who’s Going, messages and your profile" },
            ]}
          />
          {profile && !deleted && (
            <DeleteProfile
              getToken={auth.getAccessToken}
              onDeleted={() => {
                setProfile(null);
                setDeleted(true);
              }}
            />
          )}
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <section className={settingsCardClass} aria-labelledby="sign-in-title">
          <h2 id="sign-in-title" className={cardHeadingClass}>
            Sign-in
          </h2>
          <p className="body-s min-w-0 text-muted">
            <span>Signed in as </span>
            <span className="break-words">{auth.email}</span>
            {signInMethods && (
              <>
                {" · "}
                <span data-sign-in-methods="">{signInMethods}</span>
              </>
            )}
          </p>
          <Button variant="outline" size="sm" onClick={handleSignOut} className="min-h-11 self-start">
            Sign out
          </Button>
        </section>

        {eventsRow && (
          <section className={settingsCardClass} aria-labelledby="events-title">
            <h2 id="events-title" className={cardHeadingClass}>
              Events
            </h2>
            <AccountLinks
              label="Events"
              links={[EVENTS_ROWS[eventsRow], { href: "/following", label: "Organisers you follow" }]}
            />
          </section>
        )}

        <p className="label-tag text-muted">
          To delete your account, contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
            {SUPPORT_EMAIL}
          </a>
          . Tickets for upcoming events stay in your email.
        </p>
      </div>
    </div>
  );
}

function DemoAccount() {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <div className="md:col-span-2">
        <DemoNotice>Accounts aren&rsquo;t available in this demo.</DemoNotice>
      </div>
      <DemoProfileCard />
    </div>
  );
}
