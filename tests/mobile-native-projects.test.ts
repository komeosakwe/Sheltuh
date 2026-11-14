import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { APP_ID, DEFAULT_APP_SERVER_URL } from "@/lib/mobile/app-config";
import { APP_LINK_HOST, APP_LINK_PATHS } from "@/lib/mobile/well-known";

/**
 * The committed native projects (android/, ios/; docs/mobile-app.md) stay in
 * step with the shared settings, and carry nothing that ties them to a
 * signing identity or leaks the session into backups.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const MANIFEST = "android/app/src/main/AndroidManifest.xml";

function appLinkFilter(manifest: string): string {
  const filters = manifest.match(/<intent-filter android:autoVerify="true">[\s\S]*?<\/intent-filter>/g) ?? [];
  expect(filters).toHaveLength(1);
  return filters[0] ?? "";
}

const attributeValues = (xml: string, attribute: string) =>
  [...xml.matchAll(new RegExp(`android:${attribute}="([^"]*)"`, "g"))].map((m) => m[1]);

describe("Android project", () => {
  const manifest = read(MANIFEST);

  it("verifies App Links for exactly the site's host and the shared path list", () => {
    const filter = appLinkFilter(manifest);
    expect(filter).toContain('android:name="android.intent.action.VIEW"');
    expect(filter).toContain('android:name="android.intent.category.BROWSABLE"');
    expect(filter).toContain('android:name="android.intent.category.DEFAULT"');
    expect(attributeValues(filter, "scheme")).toEqual(["https"]);
    expect(attributeValues(filter, "host")).toEqual([APP_LINK_HOST]);
    expect(new URL(DEFAULT_APP_SERVER_URL).host).toBe(APP_LINK_HOST);

    // Android 14 and lower only read these (no exclusions there): "/x/*" is a prefix, the rest exact.
    const included = APP_LINK_PATHS.filter((rule) => !rule.exclude).map((rule) => rule.path);
    const expectedPrefixes = included.filter((p) => p.endsWith("/*")).map((p) => p.slice(0, -1));
    const expectedPaths = included.filter((p) => !p.includes("*"));
    expect(attributeValues(filter, "pathPrefix").sort()).toEqual(expectedPrefixes.sort());
    expect(attributeValues(filter, "path").sort()).toEqual(expectedPaths.sort());
    expect(filter).not.toMatch(/pathPattern|pathAdvancedPattern|pathSuffix/);
  });

  it("keeps the WebView's storage (the signed-in session) out of backups and phone-to-phone transfers", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read("android/app/src/main/res/xml/data_extraction_rules.xml");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] ?? "";
      expect(body).toContain('<exclude domain="root" path="./" />');
      expect(body).not.toContain("<include");
    }
  });

  it("uses the shared app id and name, with no signing configuration committed", () => {
    expect(read("android/app/build.gradle")).toMatch(new RegExp(`applicationId "${APP_ID.replace(/\./g, "\\.")}"`));
    expect(read("android/app/build.gradle")).not.toMatch(/signingConfigs|storePassword|keyPassword|storeFile/);
    const strings = read("android/app/src/main/res/values/strings.xml");
    expect(strings).toContain('<string name="app_name">Sheltüh</string>');
    expect(strings).toContain(`<string name="package_name">${APP_ID}</string>`);
    expect(manifest).not.toContain("usesCleartextTraffic");
  });

  it("keeps the site's own HTTP error pages: only network failures show the bundled page", () => {
    const activity = read("android/app/src/main/java/au/com/sheltuh/app/MainActivity.java");
    expect(activity).toContain("bridge.setWebViewClient(new SiteErrorPagesClient(bridge))");
    expect(activity).toMatch(/class SiteErrorPagesClient extends BridgeWebViewClient/);
    // HTTP errors reach Capacitor's handler as not-main-frame, so it never loads errorPath for them.
    expect(activity).toContain("super.onReceivedHttpError(view, new NotMainFrame(request), errorResponse);");
    expect(activity).toMatch(/public boolean isForMainFrame\(\) \{\s*return false;/);
    // Network failures (onReceivedError) keep Capacitor's behaviour: the bundled page.
    expect(activity).not.toContain("onReceivedError(");
  });

  it("can't have its task joined by another app's activity", () => {
    expect(manifest).toMatch(/android:name="\.MainActivity"[\s\S]*?android:taskAffinity=""/);
  });

  it("refuses release builds that don't open the production site", () => {
    expect(read("android/app/build.gradle")).toContain("apply from: 'release-guard.gradle'");
    const guard = read("android/app/release-guard.gradle");
    expect(guard).toContain(`def EXPECTED_SERVER_URL = '${DEFAULT_APP_SERVER_URL}'`);
    expect(guard).toContain("def syncedConfig = file('src/main/assets/capacitor.config.json')");
    for (const check of ["server.url != EXPECTED_SERVER_URL", "server.cleartext", "server.allowNavigation", "webContentsDebuggingEnabled"]) {
      expect(guard).toContain(check);
    }
    expect(guard).toMatch(/task\.name ==~ \/pre\\w\*ReleaseBuild\//);
  });

  it("has the brand icon's orange behind the adaptive icon", () => {
    expect(read("android/app/src/main/res/values/ic_launcher_background.xml")).toContain(
      '<color name="ic_launcher_background">#FF4800</color>',
    );
  });
});

describe("iOS project", () => {
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");

  it("uses the shared bundle id and no Apple team (the developer account isn't decided)", () => {
    const bundleIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
    expect(bundleIds.length).toBeGreaterThan(0);
    expect(new Set(bundleIds)).toEqual(new Set([APP_ID]));
    expect(pbxproj).not.toMatch(/DEVELOPMENT_TEAM|PROVISIONING_PROFILE/);
  });

  it("names the app Sheltüh and lets the system-bars plugin set the status bar", () => {
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Sheltüh<\/string>/);
    expect(plist).toMatch(/<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\/>/);
  });

  it("keeps the WebView's data (the session) out of backups, at launch and on going to the background", () => {
    const appDelegate = read("ios/App/App/AppDelegate.swift");
    expect(appDelegate).toMatch(/func excludeWebViewDataFromBackup\(\)/);
    expect(appDelegate).toContain('for name in ["WebKit", "Cookies"]');
    expect(appDelegate).toContain("values.isExcludedFromBackup = true");
    expect(appDelegate).toMatch(/didFinishLaunchingWithOptions[\s\S]*?excludeWebViewDataFromBackup\(\)[\s\S]*?return true/);
    expect(read("ios/App/App/SceneDelegate.swift")).toMatch(/func sceneDidEnterBackground\(_ scene: UIScene\) \{\s*excludeWebViewDataFromBackup\(\)/);
  });

  it("has an opaque 1024px icon (iOS fills transparency with black)", async () => {
    const meta = await sharp(path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([1024, 1024, false]);
  });
});

describe(".gitignore", () => {
  const lines = new Set(read(".gitignore").split(/\r?\n/).map((line) => line.trim()));

  it.each([
    "*.jks",
    "*.keystore",
    "*.p12",
    "*.mobileprovision",
    "key.properties",
    "*service-account*.json",
    "play-*.json",
    "/android/local.properties",
    "*.apk",
    "*.aab",
    "*.ipa",
  ])(
    "never commits %s",
    (pattern) => {
      expect(lines.has(pattern)).toBe(true);
    },
  );
});
