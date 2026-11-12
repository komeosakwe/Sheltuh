"use client";

import { ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/home/icons";
import { isApiConfigured } from "@/lib/api/client";
import { enabledOAuthProviders } from "@/lib/auth/oauth";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { JOIN_STEPS, JOIN_TITLE } from "./community-content";

/**
 * The note under the join button, true only where it's the whole story: sign-in with Google is
 * on (live, with the flag) and Apple isn't (docs §7). Otherwise none.
 */
export function joinNote(): string | null {
  if (!isApiConfigured) return null;
  const providers = enabledOAuthProviders();
  return providers.includes("google") && !providers.includes("apple") ? "Email or Google · 1 min" : null;
}

/**
 * "Your people are already here." (the proposal's join banner, redesign PR 3): an orange band
 * (black on orange, 6.18:1; the same in Light and Dark) with only the steps that exist today, See
 * who's going and Show up — or don't (the proposal's "Follow scenes" waits for Batch 3), and one
 * black action: "Join Sheltüh — free" (sign up), or, for members, "Find an event". Never an
 * orange button on orange.
 */
export default function JoinBanner({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const note = signedIn ? null : joinNote();
  return (
    <section
      aria-labelledby="community-join"
      data-surface="signal"
      className={`rounded-card p-6 md:p-12 lg:flex lg:items-center lg:justify-between lg:gap-12 lg:p-16 ${className}`.trim()}
    >
      <div className="min-w-0">
        <h2 id="community-join" className="heading-h1">
          {JOIN_TITLE}
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-2 md:mt-8">
          {JOIN_STEPS.map((step, i) => (
            <li key={step.title}>
              <span aria-hidden="true" className="mono-s">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 heading-h4">{step.title}</h3>
              <p className="mt-2 body-s font-medium">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-8 flex shrink-0 flex-col items-start gap-2 lg:mt-0 lg:items-center">
        <ButtonLink href={signedIn ? "/events" : "/signup"} variant="solid">
          {signedIn ? "Find an event" : "Join Sheltüh — free"}
          <ArrowRightIcon className="size-4 shrink-0" />
        </ButtonLink>
        {note && <p className="mono-s uppercase">{note}</p>}
      </div>
    </section>
  );
}
