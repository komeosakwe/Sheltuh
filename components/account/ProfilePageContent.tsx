"use client";

import DemoNotice from "@/components/DemoNotice";
import { ownMemberPageHref, PROFILE_HREF } from "@/components/nav/useNavAccount";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState } from "@/components/ui/Section";
import { useAuth } from "@/lib/auth/AuthContext";
import { useProfile } from "@/lib/auth/useProfile";
import { withNext } from "@/lib/safe-next-path";
import AccountPageHead from "./AccountPageHead";
import ProfileCard, { DemoProfileCard } from "./ProfileCard";

/** One card, not Settings' two columns: Your profile at a readable width. */
const COLUMN = "flex w-full max-w-2xl min-w-0 flex-col gap-6";

/**
 * /profile, the account area's Profile tab: the Your profile card (the same one Settings shows),
 * set up or edited here, and "See your public profile" once other members can open it (visible
 * and not suspended). Signed out: a way to sign in that comes back here. The demo: the sample,
 * disabled card.
 */
export default function ProfilePageContent() {
  const auth = useAuth();
  const { state, setProfile, reload } = useProfile();
  const publicHref =
    auth.configured && auth.status === "signed-in" && state.status === "ready" ? ownMemberPageHref(state.profile) : null;

  return (
    <>
      <AccountPageHead
        title="Profile"
        intro="How you show on Who’s Going lists."
        action={
          publicHref ? (
            <ButtonLink href={publicHref} variant="outline" className="max-w-full text-center">
              See your public profile
            </ButtonLink>
          ) : undefined
        }
      />
      {!auth.configured ? (
        <div className={COLUMN}>
          <DemoNotice>Accounts aren&rsquo;t available in this demo.</DemoNotice>
          <DemoProfileCard />
        </div>
      ) : auth.status === "loading" ? (
        <LoadingState text="Loading your profile…" />
      ) : auth.status === "signed-out" ? (
        <EmptyState
          title="Sign in to edit your profile"
          action={
            <ButtonLink size="lg" href={withNext("/login", PROFILE_HREF)}>
              Sign in
            </ButtonLink>
          }
        />
      ) : (
        <div className={COLUMN}>
          <ProfileCard
            state={state}
            reload={reload}
            onSaved={setProfile}
            getToken={auth.getAccessToken}
            returnTo={PROFILE_HREF}
          />
        </div>
      )}
    </>
  );
}
