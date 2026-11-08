"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageview } from "@/lib/analytics";

/**
 * One page view per route change (the App Router navigates without a page
 * load, so PostHog's own page-view capture is off). Only the path is sent:
 * never the query string or fragment (lib/analytics-privacy.ts cleans it again
 * before sending). Renders nothing, and does nothing while analytics is off.
 */
export default function AnalyticsPageviews() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) trackPageview(pathname);
  }, [pathname]);
  return null;
}
