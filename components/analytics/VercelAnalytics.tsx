"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useSyncExternalStore } from "react";
import { browserOptedOut } from "@/lib/analytics";
import { sanitizeVercelEvent } from "@/lib/analytics-privacy";

const noSubscribe = () => () => {};
/** Whether this browser asks not to be tracked. The server render (and hydration) counts as yes, so nothing loads until the browser has been asked. */
const optedOutOnClient = browserOptedOut;
const optedOutOnServer = () => true;

/** Web Analytics' beforeSend: no /admin, addresses cleaned (lib/analytics-privacy.ts), nothing at all for Do Not Track / Global Privacy Control. */
function cleanAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  return sanitizeVercelEvent(event, optedOutOnClient());
}

/** Speed Insights' beforeSend: the same rules for its Core Web Vitals reports. */
function cleanVitalsEvent<T extends { url: string; route?: string }>(event: T): T | null {
  return sanitizeVercelEvent(event, optedOutOnClient());
}

/**
 * Vercel Web Analytics (cookieless page views, visitors and referrers) and
 * Speed Insights (Core Web Vitals). Rendered by app/layout.tsx only on a Vercel
 * build (lib/vercel-analytics.ts). Nothing loads for a browser that sends Do Not
 * Track or Global Privacy Control, and /admin is never reported.
 */
export default function VercelAnalytics() {
  const optedOut = useSyncExternalStore(noSubscribe, optedOutOnClient, optedOutOnServer);
  if (optedOut) return null;
  return (
    <>
      <Analytics beforeSend={cleanAnalyticsEvent} />
      <SpeedInsights beforeSend={cleanVitalsEvent} />
    </>
  );
}
