import { describe, expect, it } from "vitest";
import { inAppBrowserName, inAppLocationHelp, locationPrompt, openInBrowserHref, shareablePageAddress } from "@/lib/in-app-browser";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36";

const AGENTS = {
  instagramIos: `${IPHONE} Instagram 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU; en-AU; scale=3.00; 1170x2532; 650834098)`,
  instagramAndroid: `${ANDROID} Instagram 340.0.0.30.109 Android (34/14; 480dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_AU; 650834098)`,
  facebookIos: `${IPHONE} [FBAN/FBIOS;FBAV/470.0.0.40.108;FBBV/600000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]`,
  facebookAndroid: `${ANDROID} [FB_IAB/FB4A;FBAV/470.0.0.40.108;]`,
  messengerIos: `${IPHONE} [FBAN/MessengerForiOS;FBAV/460.0.0.40.108;FBBV/600000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1]`,
  messengerAndroid: `${ANDROID} [FB_IAB/Orca-Android;FBAV/460.0.0.40.108;]`,
  tiktokIos: `${IPHONE} musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/AU`,
  tiktokAndroid: `${ANDROID} BytedanceWebview/d8a21c6`,
  snapchat: `${IPHONE} Snapchat/12.80.0.40 (iPhone15,2; iOS 18.1; gzip)`,
  linkedin: `${IPHONE} [LinkedInApp]/9.30.1234`,
  threads: `${IPHONE} Barcelona 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU)`,
  pinterest: `${IPHONE} [Pinterest/iOS]`,
  xIos: `${IPHONE} Twitter for iPhone`,
  xAndroid: `${ANDROID} TwitterAndroid`,
};

const ORDINARY = {
  safariIos: `${IPHONE} Version/18.1 Safari/604.1`,
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
  chromeAndroid: ANDROID,
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  edgeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
};

describe("inAppBrowserName", () => {
  it.each([
    ["instagramIos", "Instagram"],
    ["instagramAndroid", "Instagram"],
    ["facebookIos", "Facebook"],
    ["facebookAndroid", "Facebook"],
    ["messengerIos", "Messenger"],
    ["messengerAndroid", "Messenger"],
    ["tiktokIos", "TikTok"],
    ["tiktokAndroid", "TikTok"],
    ["snapchat", "Snapchat"],
    ["linkedin", "LinkedIn"],
    ["threads", "Threads"],
    ["pinterest", "Pinterest"],
    ["xIos", "X"],
    ["xAndroid", "X"],
  ] as const)("%s is %s", (key, name) => {
    expect(inAppBrowserName(AGENTS[key])).toBe(name);
  });

  it.each(Object.entries(ORDINARY))("%s is an ordinary browser", (_name, agent) => {
    expect(inAppBrowserName(agent)).toBeNull();
  });

  it("is null for an empty agent", () => {
    expect(inAppBrowserName("")).toBeNull();
  });
});

describe("openInBrowserHref", () => {
  const PAGE = "https://app.sheltuh.com.au/search?q=jazz&near=Northcote%20VIC";

  it("iOS (iPhone, and iPadOS asking for the desktop site): no link, the in-app browsers ignore x-safari-https", () => {
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108";
    expect(openInBrowserHref(PAGE, AGENTS.instagramIos)).toBeNull();
    expect(openInBrowserHref(PAGE, ipad)).toBeNull();
  });

  it("Android: Chrome via an intent URL", () => {
    expect(openInBrowserHref(PAGE, AGENTS.instagramAndroid)).toEqual({
      label: "Open in Chrome",
      browser: "Chrome",
      href: "intent://app.sheltuh.com.au/search?q=jazz&near=Northcote%20VIC#Intent;scheme=https;package=com.android.chrome;end",
    });
  });

  it("leaves the fragment and any user info off", () => {
    expect(openInBrowserHref("https://user:pw@app.sheltuh.com.au/a#access_token=secret", AGENTS.tiktokAndroid)?.href).toBe(
      "intent://app.sheltuh.com.au/a#Intent;scheme=https;package=com.android.chrome;end",
    );
    expect(openInBrowserHref("https://app.sheltuh.com.au/a#access_token=secret", AGENTS.tiktokAndroid)?.href).toBe(
      "intent://app.sheltuh.com.au/a#Intent;scheme=https;package=com.android.chrome;end",
    );
  });

  it("keeps a port", () => {
    expect(openInBrowserHref("https://example.test:8443/x", AGENTS.instagramAndroid)?.href).toBe(
      "intent://example.test:8443/x#Intent;scheme=https;package=com.android.chrome;end",
    );
  });

  it("is null for http, other schemes, unparseable addresses and other platforms", () => {
    expect(openInBrowserHref("http://app.sheltuh.com.au/", AGENTS.instagramAndroid)).toBeNull();
    expect(openInBrowserHref("javascript:alert(1)", AGENTS.instagramAndroid)).toBeNull();
    expect(openInBrowserHref("not a url", AGENTS.instagramAndroid)).toBeNull();
    expect(openInBrowserHref(PAGE, ORDINARY.edgeWindows)).toBeNull();
  });
});

describe("inAppLocationHelp", () => {
  const PAGE = "https://app.sheltuh.com.au/";

  it("names the app and points to its ••• menu on iOS, with no link", () => {
    expect(inAppLocationHelp(PAGE, AGENTS.instagramIos)).toEqual({
      text: "Instagram’s browser can’t share your location. Type your suburb, or open Sheltüh in your browser from the ••• menu.",
      link: null,
    });
  });

  it("offers Chrome on Android", () => {
    expect(inAppLocationHelp(PAGE, AGENTS.facebookAndroid)?.text).toBe(
      "Facebook’s browser can’t share your location. Type your suburb, or open Sheltüh in Chrome.",
    );
  });

  it("points to the ••• menu when there's no link to offer", () => {
    expect(inAppLocationHelp("http://localhost:3000/", AGENTS.instagramAndroid)).toEqual({
      text: "Instagram’s browser can’t share your location. Type your suburb, or open Sheltüh in your browser from the ••• menu.",
      link: null,
    });
  });

  it("is null in an ordinary browser", () => {
    expect(inAppLocationHelp(PAGE, ORDINARY.safariIos)).toBeNull();
  });
});

describe("shareablePageAddress (what /map's Open in Safari copies)", () => {
  it("is the https address without its fragment or user info", () => {
    expect(shareablePageAddress("https://user:pw@app.sheltuh.com.au/map?time=tonight&view=list#access_token=secret")).toBe(
      "https://app.sheltuh.com.au/map?time=tonight&view=list",
    );
    expect(shareablePageAddress("https://example.test:8443/map")).toBe("https://example.test:8443/map");
  });

  it("is null for http, other schemes and unparseable addresses", () => {
    expect(shareablePageAddress("http://localhost:3000/map")).toBeNull();
    expect(shareablePageAddress("javascript:alert(1)")).toBeNull();
    expect(shareablePageAddress("not a url")).toBeNull();
  });
});

describe("locationPrompt (/map's location card)", () => {
  const PAGE = "https://app.sheltuh.com.au/map?cat=art#token=secret";

  it("iOS in-app browsers (and iPadOS asking for the desktop site): copy the link, never an x-safari-https link", () => {
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108";
    for (const agent of [AGENTS.instagramIos, AGENTS.facebookIos, AGENTS.tiktokIos, ipad]) {
      expect(locationPrompt(PAGE, agent)).toEqual({ kind: "copy-link", browser: "Safari" });
    }
    // Even with no https address to copy, it's still the copy card (the steps work without the clipboard).
    expect(locationPrompt("http://localhost:3000/map", AGENTS.instagramIos)).toEqual({ kind: "copy-link", browser: "Safari" });
  });

  it("Android in-app browsers: Open in Chrome, the intent link without the fragment", () => {
    expect(locationPrompt(PAGE, AGENTS.instagramAndroid)).toEqual({
      kind: "open-link",
      browser: "Chrome",
      label: "Open in Chrome",
      href: "intent://app.sheltuh.com.au/map?cat=art#Intent;scheme=https;package=com.android.chrome;end",
    });
  });

  it("an Android in-app browser with no https address, and every ordinary browser: the browser's settings", () => {
    expect(locationPrompt("http://localhost:3000/map", AGENTS.instagramAndroid)).toEqual({ kind: "settings" });
    for (const agent of Object.values(ORDINARY)) expect(locationPrompt(PAGE, agent)).toEqual({ kind: "settings" });
  });
});
