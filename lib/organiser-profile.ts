import type { OrganiserSocialLinks } from "@/lib/api/types";

/** Longest bio the API accepts (organisers.description). */
export const MAX_BIO_LENGTH = 2000;

export type SocialNetwork = keyof OrganiserSocialLinks;

/** The order and names the social links are shown in. */
export const SOCIAL_NETWORKS: readonly { network: SocialNetwork; label: string }[] = [
  { network: "instagram", label: "Instagram" },
  { network: "tiktok", label: "TikTok" },
  { network: "facebook", label: "Facebook" },
  { network: "x", label: "X" },
];

/**
 * The social-handle fields an organiser types into, in display order. The
 * server validates them (lib/server/organiser-input.ts) and strips a leading
 * '@'; the client only shapes the request.
 */
export const SOCIAL_HANDLE_FIELDS = [
  {
    field: "instagramHandle",
    label: "Instagram username",
    prefix: "@",
    hint: "Just your username, without the @.",
  },
  {
    field: "tiktokHandle",
    label: "TikTok username",
    prefix: "@",
    hint: "Just your username, without the @.",
  },
  {
    field: "facebookPage",
    label: "Facebook page",
    prefix: "facebook.com/",
    hint: "Your page's username, as in facebook.com/yourpage.",
  },
  {
    field: "xHandle",
    label: "X username",
    prefix: "@",
    hint: "Just your username, without the @.",
  },
] as const;

export type SocialHandleField = (typeof SOCIAL_HANDLE_FIELDS)[number]["field"];
export type SocialHandleValues = Record<SocialHandleField, string>;

/** Handles as typed: trimmed, with "" meaning "clear it" (sent as null). */
export function socialHandlesForRequest(values: SocialHandleValues): Record<SocialHandleField, string | null> {
  return {
    instagramHandle: values.instagramHandle.trim() || null,
    tiktokHandle: values.tiktokHandle.trim() || null,
    facebookPage: values.facebookPage.trim() || null,
    xHandle: values.xHandle.trim() || null,
  };
}

const monthYearFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** "2026-03" -> "March 2026". Anything that isn't YYYY-MM is returned as-is rather than invented. */
export function formatMemberSince(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return yearMonth;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return yearMonth;
  return monthYearFormatter.format(new Date(Date.UTC(Number(match[1]), month - 1, 1)));
}

/** The hostname to show for a website link ("www." dropped), or null if it isn't an http(s) URL. */
export function websiteHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** A trimmed value that's a valid http(s) URL as typed (the API requires the scheme too). */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The handle in a server-built profile URL (instagram.com/name/,
 * tiktok.com/@name, facebook.com/name, x.com/name), without any '@', or null
 * if the URL can't be read.
 */
export function socialHandleFromUrl(url: string): string | null {
  try {
    const segment = new URL(url).pathname.split("/").find(Boolean);
    if (!segment) return null;
    const handle = decodeURIComponent(segment).replace(/^@/, "");
    return handle || null;
  } catch {
    return null;
  }
}

/** How a handle reads in a link: "@name", except Facebook pages, which aren't @-names. */
export function displayHandle(network: SocialNetwork, handle: string): string {
  return network === "facebook" ? handle : `@${handle}`;
}
