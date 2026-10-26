import { Roboto } from "next/font/google";

/**
 * Roboto Medium for the "Continue with Apple / Google" titles
 * (docs/design/social-sign-in.md §2): Google's sign-in buttons call for it,
 * Apple allows any face, and one face keeps the pair a set. Its own module,
 * imported only by OAuthButtons, so only the pages showing the buttons carry
 * its @font-face; not preloaded, so the file is fetched only when the
 * buttons render. OAuthButtons puts `.variable` (--font-roboto) on its root;
 * `.btn-oauth` in app/globals.css reads it.
 */
export const roboto = Roboto({
  weight: "500",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-roboto",
});
