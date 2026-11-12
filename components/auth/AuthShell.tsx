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
 * under the header and the card's content on the page. In the card: the wordmark (decorative: the
 * h1 names the page), the eyebrow, the h1, an optional intro, then the page's content.
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
      <div className="relative h-48 bg-surface md:h-80 lg:absolute lg:inset-0 lg:h-auto">
        <Image src={AUTH_PHOTO} alt="" fill preload sizes="100vw" className="object-cover" />
      </div>
      <div className="relative px-4 md:px-8">
        <div className="mx-auto w-full max-w-lg bg-background py-12 lg:max-w-xl lg:rounded-card lg:p-12">
          <Wordmark className="block h-6 w-auto" />
          <Strap label={eyebrow} rule={false} className="mt-8" />
          <h1 className="mt-4 heading-h1 break-words text-balance">{title}</h1>
          {intro && <div className="mt-4 body-m text-muted">{intro}</div>}
          <div className="mt-8 flex flex-col gap-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
