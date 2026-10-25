import Link from "next/link";

/**
 * The privacy line under a form that collects personal details
 * (docs/design/brand-direction-one.md §7, Auth; Privacy Act APP 5): where to
 * read how they're handled. 12/16 muted, links black and underlined.
 * `lead` is the sentence before the links (OAuthButtons says what
 * continuing with Apple or Google does first).
 */
export default function LegalNote({ lead = "How we handle your details:" }: { lead?: string } = {}) {
  return (
    <p className="text-xs leading-4 text-muted">
      {lead}{" "}
      <Link href="/privacy" className="text-foreground underline underline-offset-4">
        Privacy Policy
      </Link>{" "}
      ·{" "}
      <Link href="/terms" className="text-foreground underline underline-offset-4">
        Terms of Use
      </Link>
      .
    </p>
  );
}
