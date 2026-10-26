import { describe, expect, it } from "vitest";
import { devicePlatform, isInAppBrowser } from "@/lib/auth/in-app-browser";
import { isIosSafari } from "@/lib/pwa/install";
import { UA } from "./test-utils/user-agents";

describe("isInAppBrowser: where Google refuses to sign anyone in", () => {
  it.each([
    ["Instagram on iPhone", UA.iphoneInstagram],
    ["Facebook on iPhone", UA.iphoneFacebook],
    ["Instagram on Android", UA.androidInstagram],
    ["an Android WebView", UA.androidWebView],
    ["X on iPhone", `${UA.iphoneInstagram.replace(/ Instagram.*$/, "")} Twitter for iPhone/10.0`],
    ["TikTok on iPhone", `${UA.iphoneInstagram.replace(/ Instagram.*$/, "")} musical_ly_37.0.0 JsSdk/2.0`],
    ["Google's search app on iPhone", `${UA.iphoneInstagram.replace(/ Instagram.*$/, "")} GSA/350.0.0`],
  ])("is true in %s", (_name, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(true);
  });

  it.each([
    ["Safari on iPhone", UA.iphoneSafari],
    ["Chrome on iPhone", UA.iphoneChrome],
    ["Firefox on iPhone", UA.iphoneFirefox],
    ["Chrome on Android", UA.androidChrome],
    ["Firefox on Android", UA.androidFirefox],
    ["Safari on a Mac", UA.macSafari],
    ["Chrome on a Mac", UA.macChrome],
  ])("is false in %s, a real browser", (_name, userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false);
  });

  it("shares its app list with the install prompt: no in-app browser counts as iOS Safari", () => {
    expect(isIosSafari(UA.iphoneInstagram)).toBe(false);
    expect(isIosSafari(UA.iphoneFacebook)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome)).toBe(false);
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
  });
});

describe("devicePlatform: which browser the notice suggests", () => {
  it("is ios on an iPhone, and on an iPad reporting a Mac with a touch screen", () => {
    expect(devicePlatform(UA.iphoneInstagram)).toBe("ios");
    expect(devicePlatform(UA.ipadDesktopSafari, 5)).toBe("ios");
  });

  it("is android on Android, other elsewhere (a Mac without touch)", () => {
    expect(devicePlatform(UA.androidInstagram)).toBe("android");
    expect(devicePlatform(UA.androidWebView)).toBe("android");
    expect(devicePlatform(UA.macSafari)).toBe("other");
    expect(devicePlatform(UA.macSafari, 0)).toBe("other");
  });
});
