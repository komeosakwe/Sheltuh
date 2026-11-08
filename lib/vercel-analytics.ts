/**
 * Whether Vercel Web Analytics and Speed Insights are switched on for this
 * build (docs/architecture.md, "Usage analytics (PostHog)"). They are
 * cookieless; on only when building on Vercel (VERCEL=1, which Vercel sets for
 * every build), so a local run, CI and the e2e servers never load them, never in
 * demo mode (`liveMode`: Supabase configured, like PostHog), and
 * NEXT_PUBLIC_VERCEL_ANALYTICS=0 turns them off there too.
 */
export function isVercelAnalyticsEnabled(
  env: { VERCEL?: string; NEXT_PUBLIC_VERCEL_ANALYTICS?: string },
  liveMode: boolean,
): boolean {
  if (!liveMode) return false;
  if (env.NEXT_PUBLIC_VERCEL_ANALYTICS?.trim() === "0") return false;
  return env.VERCEL === "1";
}
