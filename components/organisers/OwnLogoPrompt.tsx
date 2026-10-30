"use client";

import Link from "next/link";
import { isApiConfigured } from "@/lib/api/client";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { ADD_LOGO_HREF } from "@/lib/organiser-profile";

/** Looks up the viewer's own organiser: only mounted for a signed-in visitor. */
function OwnLogoLink({ organiserId }: { organiserId: string }) {
  const { organiser } = useOrganiser();
  if (!organiser || organiser.organiserId !== organiserId || organiser.status !== "approved" || organiser.logoUrl) {
    return null;
  }
  return (
    <Link
      href={ADD_LOGO_HREF}
      data-add-logo=""
      className="flex size-24 shrink-0 items-center justify-center rounded-dot border border-dashed border-foreground px-2 text-center text-sm font-semibold underline underline-offset-4 sm:size-32"
    >
      Add logo
    </Link>
  );
}

/**
 * "Add logo" where the logo would be, on the organiser's own public profile
 * and only while they have none. Nothing for anyone else, signed out, or in
 * the demo (no accounts, no request).
 */
export default function OwnLogoPrompt({ organiserId }: { organiserId: string }) {
  const auth = useOptionalAuth();
  if (!isApiConfigured || auth?.status !== "signed-in") return null;
  return <OwnLogoLink organiserId={organiserId} />;
}
