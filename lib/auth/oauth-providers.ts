/**
 * The Google / Apple provider list and the brand artwork each one needs.
 * No imports, so next.config.ts can load it too (its build-time logo check).
 * lib/auth/oauth.ts re-exports all of it: import from there in the app.
 */

/** The providers Sheltüh offers, as Supabase Auth names them. */
export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The providers listed in a NEXT_PUBLIC_AUTH_PROVIDERS value: comma
 * separated, any case, spaces ignored. Unknown names and repeats are dropped;
 * the order given is kept.
 */
export function parseAuthProviders(raw: string | undefined): OAuthProvider[] {
  if (!raw) return [];
  const providers: OAuthProvider[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (isOAuthProvider(name) && !providers.includes(name)) providers.push(name);
  }
  return providers;
}

/**
 * The official artwork each provider's button shows, served from
 * public/auth/ (so at /auth/<file>): the vendors' own files, unmodified
 * (docs/auth-logos.md says where each comes from). No stand-in may ship, so
 * next.config.ts fails the build when NEXT_PUBLIC_AUTH_PROVIDERS lists a
 * provider whose files are missing.
 *
 * - Apple: Apple's "logo only" artwork, in both colours. The White theme's
 *   button is black with a white logo; the Dark theme's is white with a
 *   black logo (Apple: logo and title both white, or both black). Not
 *   committed: the owner adds them.
 * - Google: the standard multi-colour "G" (one file, both themes), shown
 *   inside a button Google's branding guidelines describe, with the title
 *   "Continue with Google" as real text. Committed.
 */
export const OAUTH_LOGO_FILES: Record<OAuthProvider, readonly string[]> = {
  apple: ["apple-logo-white.svg", "apple-logo-black.svg"],
  google: ["google-g.svg"],
};

/** Where the logo files are served from: public/auth/<file>. */
export const OAUTH_LOGO_PATH = "/auth";

/**
 * The logo files (names in public/auth/) the providers in `raw` (a
 * NEXT_PUBLIC_AUTH_PROVIDERS value) need but that `exists` can't find, in
 * provider order. Empty when nothing's missing or no provider is listed.
 */
export function missingOAuthLogos(raw: string | undefined, exists: (file: string) => boolean): string[] {
  return parseAuthProviders(raw).flatMap((provider) => OAUTH_LOGO_FILES[provider].filter((file) => !exists(file)));
}
