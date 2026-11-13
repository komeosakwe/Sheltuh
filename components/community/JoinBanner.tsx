"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/home/icons";
import { isApiConfigured } from "@/lib/api/client";
import { enabledOAuthProviders } from "@/lib/auth/oauth";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { JOIN_EYEBROW, JOIN_FEATURES, JOIN_LEDE, JOIN_TITLE } from "./community-content";

/**
 * The note under the join button, true only where it's the whole story: sign-in with Google is
 * on (live, with the flag) and Apple isn't (docs §7). Otherwise none.
 */
export function joinNote(): string | null {
  if (!isApiConfigured) return null;
  const providers = enabledOAuthProviders();
  return providers.includes("google") && !providers.includes("apple") ? "Email or Google · 1 min" : null;
}

/** Line icons for the two features (decorative: each feature's title says it). */
function FeatureIcon({ kind }: { kind: "people" | "visibility" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 size-7 shrink-0"
    >
      {kind === "people" ? (
        <>
          <circle cx="9" cy="8" r="3.25" />
          <path d="M3.5 19.5c0-3 2.5-5.25 5.5-5.25s5.5 2.25 5.5 5.25" />
          <path d="M15.5 4.9a3.25 3.25 0 0 1 0 6.2M17.5 14.6c1.9.6 3 2.4 3 4.9" />
        </>
      ) : (
        <>
          <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6Z" />
          <rect x="9.25" y="11" width="5.5" height="4.5" rx="1" />
          <path d="M10.25 11V9.75a1.75 1.75 0 0 1 3.5 0V11" />
        </>
      )}
    </svg>
  );
}

/**
 * "Find your people." (the owner's newer join banner, 13 Nov 2026, replacing the proposal's
 * "Your people are already here."): an orange band (black on orange, 6.18:1; the same in Light and
 * Dark) with the eyebrow, title and line, the two things membership gives today (See who's going;
 * your visibility, your choice) each with a line icon, and, after a rule from lg, one black action:
 * "Join Sheltüh — free" (sign up) with "Already a member? Sign in" under it, or, for members, "Find
 * an event". Never an orange button on orange.
 */
export default function JoinBanner({ className = "" }: { className?: string }) {
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signed-in";
  const note = signedIn ? null : joinNote();
  return (
    <section
      aria-labelledby="community-join"
      data-surface="signal"
      className={`rounded-card p-6 md:p-10 lg:p-12 ${className}`.trim()}
    >
      <p className="text-sm leading-5 font-semibold uppercase">{JOIN_EYEBROW}</p>
      <h2 id="community-join" className="mt-2 heading-h1">
        {JOIN_TITLE}
      </h2>
      <p className="mt-2 body-m font-medium">{JOIN_LEDE}</p>
      <div className="mt-6 flex flex-col gap-8 md:mt-8 lg:flex-row lg:items-center lg:gap-0">
        <ul className="grid min-w-0 flex-1 gap-6 sm:grid-cols-2 lg:pr-10">
          {JOIN_FEATURES.map((feature) => (
            <li key={feature.title} className="flex gap-3">
              <FeatureIcon kind={feature.icon} />
              <div className="min-w-0">
                <h3 className="heading-h4">{feature.title}</h3>
                <p className="mt-1 body-s font-medium">{feature.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div
          data-join-action=""
          className="flex shrink-0 flex-col items-start gap-3 lg:items-center lg:self-stretch lg:justify-center lg:border-l lg:border-current lg:pl-10"
        >
          <ButtonLink href={signedIn ? "/events" : "/signup"} variant="solid">
            {signedIn ? "Find an event" : "Join Sheltüh — free"}
            <ArrowRightIcon className="size-4 shrink-0" />
          </ButtonLink>
          {!signedIn && (
            <p className="body-s font-medium">
              Already a member?{" "}
              <Link href="/login" className="underline underline-offset-4 hover:decoration-2">
                Sign in
              </Link>
            </p>
          )}
          {note && <p className="mono-s uppercase">{note}</p>}
        </div>
      </div>
    </section>
  );
}
