/** Where people reach Sheltüh (a Google Workspace alias). */
export const SUPPORT_EMAIL = "support@sheltuh.com.au";

/**
 * Sheltüh's own social accounts (owner, 13 Nov 2026), shown in the footer's Contact Sheltüh, in this order:
 * Latte's 1120 footer draws LinkedIn, then Instagram, then email. Its frames have no TikTok, so the footer
 * leaves it out (https://www.tiktok.com/@findsheltuh; whether to bring it back is with the owner).
 */
export const SHELTUH_SOCIALS = [
  { network: "linkedin", name: "LinkedIn", href: "https://www.linkedin.com/company/sheltuh/" },
  { network: "instagram", name: "Instagram", href: "https://www.instagram.com/findsheltuh/" },
] as const;
