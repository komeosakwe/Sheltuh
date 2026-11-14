import {
  appleAppSiteAssociation,
  assetLinks,
  type WellKnownResult,
} from "@/lib/mobile/well-known";

/*
 * The phone app's deep-link verification files (docs/mobile-app.md, "Deep
 * links"). The pure builders and the covered paths live in
 * lib/mobile/well-known.ts, shared with the app's deep-link check; this file
 * reads the server-only variables and shapes the response.
 */

const loggedProblems = new Set<string>();

/**
 * The route's answer: the JSON with `application/json` and no redirect, or
 * an empty 404. A misconfiguration is logged once per server instance, by
 * variable name only.
 */
export function wellKnownResponse(result: WellKnownResult, file: string): Response {
  if (result.status === "on") {
    return new Response(JSON.stringify(result.body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Short: the platforms cache it themselves (Apple's CDN, Android's verifier), and a
        // fix to the variables should reach them on their next fetch.
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (result.status === "misconfigured" && !loggedProblems.has(result.problem)) {
    loggedProblems.add(result.problem);
    console.warn(`${file} is off: ${result.problem}.`);
  }
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * GET /.well-known/assetlinks.json (app/.well-known/assetlinks.json/route.ts):
 * 404 until ANDROID_APP_PACKAGE_NAME and ANDROID_APP_CERT_FINGERPRINTS are
 * set. The variables are read on each request.
 */
export function assetLinksRoute(): Response {
  return wellKnownResponse(
    assetLinks({
      ANDROID_APP_PACKAGE_NAME: process.env.ANDROID_APP_PACKAGE_NAME,
      ANDROID_APP_CERT_FINGERPRINTS: process.env.ANDROID_APP_CERT_FINGERPRINTS,
    }),
    "/.well-known/assetlinks.json",
  );
}

/**
 * GET /.well-known/apple-app-site-association
 * (app/.well-known/apple-app-site-association/route.ts): 404 until
 * IOS_APP_TEAM_ID and IOS_APP_BUNDLE_ID are set.
 */
export function appleAppSiteAssociationRoute(): Response {
  return wellKnownResponse(
    appleAppSiteAssociation({
      IOS_APP_TEAM_ID: process.env.IOS_APP_TEAM_ID,
      IOS_APP_BUNDLE_ID: process.env.IOS_APP_BUNDLE_ID,
    }),
    "/.well-known/apple-app-site-association",
  );
}
