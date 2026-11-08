import { initAnalytics } from "@/lib/analytics";

/**
 * Runs in the browser before the app hydrates (Next's instrumentation-client).
 * Starts usage analytics, which does nothing unless NEXT_PUBLIC_POSTHOG_KEY is
 * set, the site is live (not the demo) and the visitor hasn't asked not to be
 * tracked (docs/architecture.md, "Usage analytics (PostHog)").
 */
initAnalytics();
