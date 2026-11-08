/**
 * Campaign links (/admin/campaign-links): a page address with UTM parameters
 * (utm_source, utm_medium, utm_campaign, utm_content) so usage analytics can
 * show signups and revenue by campaign (docs/architecture.md, "Marketing
 * analytics"). Pure and client-side: nothing is stored.
 *
 * These are the only query parameters analytics keeps from an address
 * (lib/analytics-privacy.ts).
 */

/** The longest value of one parameter. */
export const CAMPAIGN_VALUE_MAX = 50;

/**
 * A value as it goes in the link: lower case, spaces and punctuation as
 * hyphens, only a–z, 0–9, hyphen and underscore, so "Spring Launch!" and
 * "spring-launch" count as one campaign. "" if nothing is left.
 */
export function campaignValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CAMPAIGN_VALUE_MAX)
    .replace(/-+$/g, "");
}

export interface CampaignLinkInput {
  /** The public origin, e.g. https://sheltuh.com.au. */
  origin: string;
  /** The page, as a path from the site's root: "/", "/map", "/events/night-market". */
  path: string;
  source: string;
  medium: string;
  campaign: string;
  /** Optional: tells links in one campaign apart (a particular post, a button). */
  content?: string;
}

/**
 * The full link, or null until the origin, the path (a site path, not another
 * address) and all of source, medium and campaign are filled in.
 */
export function buildCampaignLink(input: CampaignLinkInput): string | null {
  if (!input.path.startsWith("/") || input.path.startsWith("//") || /[?#\s]/.test(input.path)) return null;
  const source = campaignValue(input.source);
  const medium = campaignValue(input.medium);
  const campaign = campaignValue(input.campaign);
  if (!source || !medium || !campaign) return null;
  let url: URL;
  try {
    url = new URL(input.path, input.origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", campaign);
  const content = campaignValue(input.content ?? "");
  if (content) url.searchParams.set("utm_content", content);
  return url.toString();
}

/** Suggestions for the source and medium fields (anything can be typed). */
export const SOURCE_SUGGESTIONS = ["instagram", "tiktok", "facebook", "email", "partner"] as const;
export const MEDIUM_SUGGESTIONS = ["bio", "story", "post", "paid", "newsletter", "qr"] as const;
