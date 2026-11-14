/**
 * The phone app's deep-link verification files (docs/mobile-app.md, "Deep
 * links"), served by app/.well-known/…/route.ts:
 *
 * - /.well-known/assetlinks.json (Android App Links), from
 *   ANDROID_APP_PACKAGE_NAME and ANDROID_APP_CERT_FINGERPRINTS;
 * - /.well-known/apple-app-site-association (iOS Universal Links), from
 *   IOS_APP_TEAM_ID and IOS_APP_BUNDLE_ID.
 *
 * Each **switches itself on** once its variables are set (as with wallet
 * passes, docs/wallet-setup.md) and answers 404 until then, so nothing here
 * depends on an Apple team or a signing key existing yet. A value that's
 * there but malformed also means 404, and one log line naming the variable
 * (never its value).
 *
 * The values are public by design (both files are world-readable); they're
 * server-side variables only so a deploy, not a code change, turns them on.
 */

/** The only host the app's links are for (the site's production domain, docs/DEPLOYMENT.md). */
export const APP_LINK_HOST = "sheltuh.com.au";

export interface AppLinkPath {
  /** A path pattern: "*" matches any run of characters ("/" included). */
  path: string;
  /** Never open these in the app (checked before the rest, in order). */
  exclude?: true;
  /** Why, for the file and for people reading it. */
  comment: string;
}

/**
 * The site addresses the app opens, in order (the first match wins). Kept
 * small on purpose:
 *
 * - event pages, the links people share and find on Instagram;
 * - the ticket page (/checkout/success?session_id=…), where the ticket email's
 *   button goes.
 *
 * Not sign-in (/auth/*): a sign-in started in a browser keeps its one-time
 * code verifier in that browser, so its return must land there too
 * (increment 2 adds the app's own sign-in return). Not the payment page or
 * the emailed confirm and unsubscribe links, which finish where they started.
 * The calendar file (/events/{slug}/calendar.ics) stays out so the phone's
 * calendar opens it.
 *
 * android/app/src/main/AndroidManifest.xml lists the same paths for Android
 * 14 and lower (which can't read these rules or exclusions);
 * tests/mobile-native-projects.test.ts keeps the two in step.
 */
export const APP_LINK_PATHS: readonly AppLinkPath[] = [
  { path: "/events/*/calendar.ics", exclude: true, comment: "Calendar files open in the phone's calendar." },
  { path: "/events", comment: "The events list." },
  { path: "/events/*", comment: "Event pages." },
  { path: "/checkout/success", comment: "Your tickets (the ticket email's link)." },
];

export type WellKnownEnv = Partial<
  Record<"ANDROID_APP_PACKAGE_NAME" | "ANDROID_APP_CERT_FINGERPRINTS" | "IOS_APP_TEAM_ID" | "IOS_APP_BUNDLE_ID", string>
>;

export type WellKnownResult =
  | { status: "on"; body: unknown }
  | { status: "off" }
  | { status: "misconfigured"; problem: string };

// An Android application id: dot-separated segments, each starting with a letter.
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
// A SHA-256 certificate fingerprint as keytool and Play Console print it: 32 hex bytes, colon-separated.
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
// Apple's Team ID (the App ID prefix): 10 characters, letters and digits.
const APPLE_TEAM_ID = /^[A-Z0-9]{10}$/;
// A bundle id: reverse-DNS, letters, digits, hyphens and dots.
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function value(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The statement list for /.well-known/assetlinks.json (Android's format:
 * developer.android.com/training/app-links/configure-assetlinks), or why it's
 * off. Fingerprints are comma- or space-separated (the upload key and Play's
 * app signing key, a debug key for testing…).
 */
export function assetLinks(env: WellKnownEnv): WellKnownResult {
  const packageName = value(env.ANDROID_APP_PACKAGE_NAME);
  const fingerprintList = value(env.ANDROID_APP_CERT_FINGERPRINTS);
  if (!packageName && !fingerprintList) return { status: "off" };
  if (!packageName) return { status: "misconfigured", problem: "ANDROID_APP_PACKAGE_NAME isn't set" };
  if (!ANDROID_PACKAGE.test(packageName)) {
    return { status: "misconfigured", problem: "ANDROID_APP_PACKAGE_NAME isn't an Android application id (e.g. au.com.sheltuh.app)" };
  }
  if (!fingerprintList) return { status: "misconfigured", problem: "ANDROID_APP_CERT_FINGERPRINTS isn't set" };
  const fingerprints = [...new Set(fingerprintList.split(/[\s,]+/).filter(Boolean).map((f) => f.toUpperCase()))];
  if (fingerprints.length === 0 || !fingerprints.every((f) => SHA256_FINGERPRINT.test(f))) {
    return {
      status: "misconfigured",
      problem: "ANDROID_APP_CERT_FINGERPRINTS must be SHA-256 fingerprints (32 hex pairs separated by colons), comma-separated",
    };
  }
  return {
    status: "on",
    body: [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
        // Android 15+ reads these rules (and their exclusion); older versions use the manifest's
        // paths. No comment field: Android's documented keys only, since it discards the whole
        // set if any of it is malformed.
        relation_extensions: {
          "delegate_permission/common.handle_all_urls": {
            dynamic_app_link_components: APP_LINK_PATHS.map(({ path, exclude }) => ({
              "/": path,
              ...(exclude ? { exclude: true } : {}),
            })),
          },
        },
      },
    ],
  };
}

/**
 * /.well-known/apple-app-site-association (Apple's format:
 * developer.apple.com/documentation/xcode/supporting-associated-domains), or
 * why it's off. `webcredentials` lets iOS offer saved Sheltüh passwords in
 * the app's sign-in form once the app has that entitlement.
 */
export function appleAppSiteAssociation(env: WellKnownEnv): WellKnownResult {
  const teamId = value(env.IOS_APP_TEAM_ID);
  const bundleId = value(env.IOS_APP_BUNDLE_ID);
  if (!teamId && !bundleId) return { status: "off" };
  if (!teamId) return { status: "misconfigured", problem: "IOS_APP_TEAM_ID isn't set" };
  if (!APPLE_TEAM_ID.test(teamId)) {
    return { status: "misconfigured", problem: "IOS_APP_TEAM_ID isn't an Apple Team ID (10 capital letters and digits)" };
  }
  if (!bundleId) return { status: "misconfigured", problem: "IOS_APP_BUNDLE_ID isn't set" };
  if (!BUNDLE_ID.test(bundleId)) {
    return { status: "misconfigured", problem: "IOS_APP_BUNDLE_ID isn't a bundle id (e.g. au.com.sheltuh.app)" };
  }
  const appId = `${teamId}.${bundleId}`;
  return {
    status: "on",
    body: {
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: APP_LINK_PATHS.map(({ path, exclude, comment }) => ({
              "/": path,
              ...(exclude ? { exclude: true } : {}),
              comment,
            })),
          },
        ],
      },
      webcredentials: { apps: [appId] },
    },
  };
}

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
