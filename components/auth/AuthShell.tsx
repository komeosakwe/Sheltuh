import Image from "next/image";
import type { ReactNode } from "react";
import Wordmark from "@/components/brand/Wordmark";
import Strap from "@/components/ui/Strap";

/**
 * A licensed photo (public/events/README.md: hands in a record crate, no face, no logo). Never the
 * proposal's people-with-smileys photos, which have no model release.
 */
export const AUTH_PHOTO = "/events/dj-crate-digging.jpg";

/**
 * The account pages' frame (redesign PR 6; the owner's sign-in mock): from 1024px a full-bleed
 * photo with the page's own colour as a centred card on it (white on White, black on Dark, so
 * Apple's and Google's buttons keep their page-background rules); below that, the photo as a band
 * under the header (320px from 768px, 96px from 640px) and the card's content on the page. Phones
 * get no band: the email field and Continue must be in the first screen at 375×667
 * (e2e/oauth.spec.ts). In the card: the wordmark from 640px (decorative: the h1 names the page), the
 * eyebrow, the h1, an optional intro, then the page's content.
 *
 * The card fits its content (Round 2, Sign in): at most 480px wide, 40px of padding from 1024px,
 * no fixed height; below 1024px 32px above and below, with the page's own side margins (16px; the
 * column stays 343px at 375). The h1 is heading-section-l (24/32, 32/40 from 768px) and the
 * groups (the heading, then each of the page's own: form, social, links) are 24px apart.
 *
 * Phones (below 640px, the owner's iPhone screenshots): no wordmark, 24px above and below, the
 * eyebrow, h1 and intro closer (12px, 8px) and the groups 20px apart, so /login's Continue with
 * Apple and Google are in the first screen at 390×664 (Safari with its bars) and 375×600
 * (e2e/oauth.spec.ts). Inputs and buttons stay 48px.
 */
export default function AuthShell({
  eyebrow = "Account",
  title,
  intro,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative lg:py-16">
      <div className="relative hidden h-24 bg-surface sm:block md:h-80 lg:absolute lg:inset-0 lg:h-auto">
        <Image src={AUTH_PHOTO} alt="" fill preload sizes="100vw" className="object-cover" />
      </div>
      <div className="relative px-4 md:px-8">
        <div data-auth-card="" className="mx-auto w-full max-w-120 bg-background py-6 sm:py-8 lg:rounded-card lg:p-10">
          {/* Phones: none (the header shows the mark), so Apple and Google fit in the first screen. */}
          <Wordmark className="hidden h-6 w-auto sm:block" />
          <Strap label={eyebrow} rule={false} className="sm:mt-8" />
          <h1 className="mt-3 heading-section-l break-words text-balance sm:mt-4">{title}</h1>
          {intro && <div className="mt-2 body-m text-muted sm:mt-4">{intro}</div>}
          <div className="mt-5 flex flex-col gap-5 sm:mt-6 sm:gap-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
