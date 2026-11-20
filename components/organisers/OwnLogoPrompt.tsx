"use client";

import Link from "next/link";
import { isApiConfigured } from "@/lib/api/client";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { ADD_LOGO_HREF } from "@/lib/organiser-profile";

/** Looks up the viewer's own organiser: only mounted for a signed-in visitor. */
function OwnLogoLink({ organiserId, overlap }: { organiserId: string; overlap: boolean }) {
  const { organiser } = useOrganiser();
  if (!organiser || organiser.organiserId !== organiserId || organiser.status !== "approved" || organiser.logoUrl) {
    return null;
  }
  return (
    <Link
      href={ADD_LOGO_HREF}
      data-add-logo=""
      // The logo's own sizes (OrganiserLogo `profile`). Over a cover it's filled and ringed with the page colour,
      // so the photo doesn't show through its dashed edge, and its focus ring sits on that ring.
      className={`flex size-24 shrink-0 items-center justify-center rounded-dot border border-dashed border-foreground px-2 text-center text-sm font-semibold underline underline-offset-4 sm:size-32 xl:size-40 ${
        overlap ? "bg-background ring-4 ring-background" : ""
      }`.trim()}
    >
      Add logo
    </Link>
  );
}

/**
 * "Add logo" where the logo would be, on the organiser's own public profile
 * and only while they have none. Nothing for anyone else, signed out, or in
 * the demo (no accounts, no request). `overlap`: it sits over the cover's
 * bottom-left corner, as the logo would.
 */
export default function OwnLogoPrompt({ organiserId, overlap = false }: { organiserId: string; overlap?: boolean }) {
  const auth = useOptionalAuth();
  if (!isApiConfigured || auth?.status !== "signed-in") return null;
  return <OwnLogoLink organiserId={organiserId} overlap={overlap} />;
}
