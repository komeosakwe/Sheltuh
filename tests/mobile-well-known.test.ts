import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { GET as appleRoute } from "@/app/.well-known/apple-app-site-association/route";
import { GET as androidRoute } from "@/app/.well-known/assetlinks.json/route";
import { APP_LINK_PATHS, appleAppSiteAssociation, assetLinks } from "@/lib/mobile/well-known";

// Synthetic values only: a made-up fingerprint and team id.
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7).toString(16).padStart(2, "0").slice(-2).toUpperCase()).join(":");
const FINGERPRINT_2 = Array.from({ length: 32 }, () => "AB").join(":");
const TEAM_ID = "ABCDE12345";
const BUNDLE_ID = "au.com.sheltuh.app";

const ENV_NAMES = ["ANDROID_APP_PACKAGE_NAME", "ANDROID_APP_CERT_FINGERPRINTS", "IOS_APP_TEAM_ID", "IOS_APP_BUNDLE_ID"];

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  for (const name of ENV_NAMES) vi.stubEnv(name, "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("assetLinks (Android App Links)", () => {
  it("is off when nothing is set", () => {
    expect(assetLinks({})).toEqual({ status: "off" });
    expect(assetLinks({ ANDROID_APP_PACKAGE_NAME: " ", ANDROID_APP_CERT_FINGERPRINTS: "" })).toEqual({ status: "off" });
  });

  it("lists the app, every fingerprint (upper-cased, de-duplicated) and the path rules", () => {
    const result = assetLinks({
      ANDROID_APP_PACKAGE_NAME: BUNDLE_ID,
      ANDROID_APP_CERT_FINGERPRINTS: `${FINGERPRINT.toLowerCase()}, ${FINGERPRINT_2}\n${FINGERPRINT}`,
    });
    expect(result).toEqual({
      status: "on",
      body: [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: BUNDLE_ID, sha256_cert_fingerprints: [FINGERPRINT, FINGERPRINT_2] },
          relation_extensions: {
            "delegate_permission/common.handle_all_urls": {
              dynamic_app_link_components: [
                { "/": "/events/*/calendar.ics", exclude: true },
                { "/": "/events" },
                { "/": "/events/*" },
                { "/": "/checkout/success" },
              ],
            },
          },
        },
      ],
    });
  });

  it.each([
    [{ ANDROID_APP_CERT_FINGERPRINTS: FINGERPRINT }, "ANDROID_APP_PACKAGE_NAME isn't set"],
    [{ ANDROID_APP_PACKAGE_NAME: "sheltuh", ANDROID_APP_CERT_FINGERPRINTS: FINGERPRINT }, "ANDROID_APP_PACKAGE_NAME isn't an Android application id"],
    [{ ANDROID_APP_PACKAGE_NAME: "au.com.sheltuh-app", ANDROID_APP_CERT_FINGERPRINTS: FINGERPRINT }, "ANDROID_APP_PACKAGE_NAME isn't an Android application id"],
    [{ ANDROID_APP_PACKAGE_NAME: BUNDLE_ID }, "ANDROID_APP_CERT_FINGERPRINTS isn't set"],
    [{ ANDROID_APP_PACKAGE_NAME: BUNDLE_ID, ANDROID_APP_CERT_FINGERPRINTS: "AB:CD" }, "ANDROID_APP_CERT_FINGERPRINTS must be SHA-256"],
    [{ ANDROID_APP_PACKAGE_NAME: BUNDLE_ID, ANDROID_APP_CERT_FINGERPRINTS: FINGERPRINT.replace(/:/g, "") }, "ANDROID_APP_CERT_FINGERPRINTS must be SHA-256"],
    [{ ANDROID_APP_PACKAGE_NAME: BUNDLE_ID, ANDROID_APP_CERT_FINGERPRINTS: `${FINGERPRINT},nope` }, "ANDROID_APP_CERT_FINGERPRINTS must be SHA-256"],
  ])("is misconfigured with %j", (env, problem) => {
    const result = assetLinks(env);
    expect(result.status).toBe("misconfigured");
    expect(result.status === "misconfigured" && result.problem).toContain(problem);
  });
});

describe("appleAppSiteAssociation (iOS Universal Links)", () => {
  it("is off when nothing is set", () => {
    expect(appleAppSiteAssociation({})).toEqual({ status: "off" });
  });

  it("lists the app id (Team ID + bundle id) with the same paths, and web credentials", () => {
    const result = appleAppSiteAssociation({ IOS_APP_TEAM_ID: TEAM_ID, IOS_APP_BUNDLE_ID: BUNDLE_ID });
    expect(result).toEqual({
      status: "on",
      body: {
        applinks: {
          details: [
            {
              appIDs: [`${TEAM_ID}.${BUNDLE_ID}`],
              components: APP_LINK_PATHS.map((rule) => ({
                "/": rule.path,
                ...(rule.exclude ? { exclude: true } : {}),
                comment: rule.comment,
              })),
            },
          ],
        },
        webcredentials: { apps: [`${TEAM_ID}.${BUNDLE_ID}`] },
      },
    });
  });

  it.each([
    [{ IOS_APP_BUNDLE_ID: BUNDLE_ID }, "IOS_APP_TEAM_ID isn't set"],
    [{ IOS_APP_TEAM_ID: "abcde12345", IOS_APP_BUNDLE_ID: BUNDLE_ID }, "IOS_APP_TEAM_ID isn't an Apple Team ID"],
    [{ IOS_APP_TEAM_ID: "ABCDE1234", IOS_APP_BUNDLE_ID: BUNDLE_ID }, "IOS_APP_TEAM_ID isn't an Apple Team ID"],
    [{ IOS_APP_TEAM_ID: TEAM_ID }, "IOS_APP_BUNDLE_ID isn't set"],
    [{ IOS_APP_TEAM_ID: TEAM_ID, IOS_APP_BUNDLE_ID: "sheltuh" }, "IOS_APP_BUNDLE_ID isn't a bundle id"],
    [{ IOS_APP_TEAM_ID: TEAM_ID, IOS_APP_BUNDLE_ID: "au.com.sheltuh app" }, "IOS_APP_BUNDLE_ID isn't a bundle id"],
  ])("is misconfigured with %j", (env, problem) => {
    const result = appleAppSiteAssociation(env);
    expect(result.status).toBe("misconfigured");
    expect(result.status === "misconfigured" && result.problem).toContain(problem);
  });
});

describe("the path rules", () => {
  it("excludes the calendar file before the event pages match it, and never covers sign-in or payment", () => {
    expect(APP_LINK_PATHS[0]).toMatchObject({ path: "/events/*/calendar.ics", exclude: true });
    const included = APP_LINK_PATHS.filter((rule) => !rule.exclude).map((rule) => rule.path);
    expect(included).toEqual(["/events", "/events/*", "/checkout/success"]);
    for (const path of included) expect(path).not.toMatch(/^\/(auth|login|signup|checkout\/(pay|confirm)|waitlist|api)/);
  });
});

describe("GET /.well-known/assetlinks.json", () => {
  it("is 404 with no body while unset, and logs nothing", async () => {
    const response = androidRoute();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });

  it("serves JSON as application/json once configured (200, no redirect)", async () => {
    vi.stubEnv("ANDROID_APP_PACKAGE_NAME", BUNDLE_ID);
    vi.stubEnv("ANDROID_APP_CERT_FINGERPRINTS", FINGERPRINT);
    const response = androidRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("location")).toBeNull();
    const body = await response.json();
    expect(body[0].target).toEqual({ namespace: "android_app", package_name: BUNDLE_ID, sha256_cert_fingerprints: [FINGERPRINT] });
  });

  it("is 404 when half set, logging the variable's name but never a value", async () => {
    vi.stubEnv("ANDROID_APP_CERT_FINGERPRINTS", FINGERPRINT);
    const response = androidRoute();
    expect(response.status).toBe(404);
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("ANDROID_APP_PACKAGE_NAME");
    expect(logged).not.toContain(FINGERPRINT);
  });
});

describe("GET /.well-known/apple-app-site-association", () => {
  it("is 404 while unset", async () => {
    const response = appleRoute();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("serves JSON as application/json once configured", async () => {
    vi.stubEnv("IOS_APP_TEAM_ID", TEAM_ID);
    vi.stubEnv("IOS_APP_BUNDLE_ID", BUNDLE_ID);
    const response = appleRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await response.json();
    expect(body.applinks.details[0].appIDs).toEqual([`${TEAM_ID}.${BUNDLE_ID}`]);
  });

  it("is 404 with a malformed Team ID, naming only the variable", async () => {
    vi.stubEnv("IOS_APP_TEAM_ID", "not-a-team");
    vi.stubEnv("IOS_APP_BUNDLE_ID", BUNDLE_ID);
    const response = appleRoute();
    expect(response.status).toBe(404);
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("IOS_APP_TEAM_ID");
    expect(logged).not.toContain("not-a-team");
  });
});
