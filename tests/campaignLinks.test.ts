import { describe, expect, it } from "vitest";
import { buildCampaignLink, campaignValue } from "@/lib/campaign-links";
import { sanitizeUrl } from "@/lib/analytics-privacy";

const ORIGIN = "https://sheltuh.com.au";

describe("campaignValue", () => {
  it("lower-cases, turns spaces and punctuation into hyphens and trims", () => {
    expect(campaignValue("  Spring Launch! ")).toBe("spring-launch");
    expect(campaignValue("IG Story #2")).toBe("ig-story-2");
    expect(campaignValue("tiktok")).toBe("tiktok");
    expect(campaignValue("a_b")).toBe("a_b");
    expect(campaignValue("???")).toBe("");
  });

  it("is capped at 50 characters, without a trailing hyphen", () => {
    expect(campaignValue("x".repeat(80))).toHaveLength(50);
    expect(campaignValue(`${"x".repeat(49)} yyy`)).toBe("x".repeat(49));
  });
});

describe("buildCampaignLink", () => {
  const base = { origin: ORIGIN, path: "/", source: "Instagram", medium: "bio", campaign: "Spring Launch" };

  it("builds the full UTM address", () => {
    expect(buildCampaignLink(base)).toBe(`${ORIGIN}/?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`);
    expect(buildCampaignLink({ ...base, path: "/events/night-market", content: "Reel 1" })).toBe(
      `${ORIGIN}/events/night-market?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch&utm_content=reel-1`,
    );
    expect(buildCampaignLink({ ...base, path: "/map" })).toBe(`${ORIGIN}/map?utm_source=instagram&utm_medium=bio&utm_campaign=spring-launch`);
  });

  it("needs a source, a medium and a campaign", () => {
    expect(buildCampaignLink({ ...base, source: " " })).toBeNull();
    expect(buildCampaignLink({ ...base, medium: "" })).toBeNull();
    expect(buildCampaignLink({ ...base, campaign: "!!!" })).toBeNull();
  });

  it("only links to a page on the site, with no query or fragment of its own", () => {
    expect(buildCampaignLink({ ...base, path: "" })).toBeNull();
    expect(buildCampaignLink({ ...base, path: "https://evil.example/" })).toBeNull();
    expect(buildCampaignLink({ ...base, path: "//evil.example/" })).toBeNull();
    expect(buildCampaignLink({ ...base, path: "/events/x?token=1" })).toBeNull();
    expect(buildCampaignLink({ ...base, path: "/events/x#token" })).toBeNull();
    expect(buildCampaignLink({ ...base, origin: "ftp://sheltuh.com.au" })).toBeNull();
    expect(buildCampaignLink({ ...base, origin: "nonsense" })).toBeNull();
  });

  it("makes links whose parameters analytics keeps whole", () => {
    const link = buildCampaignLink({ ...base, path: "/events/night-market", content: "reel-1" });
    expect(link).not.toBeNull();
    expect(sanitizeUrl(link ?? "")).toBe(link);
  });
});
