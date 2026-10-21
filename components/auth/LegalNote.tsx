import Link from "next/link";

/**
 * The privacy line under a form that collects personal details
 * (docs/design/brand-direction-one.md §7, Auth; Privacy Act APP 5): where to
 * read how they're handled. 12/16 muted, links black and underlined.
 */
export default function LegalNote() {
  return (
    <p className="text-xs leading-4 text-muted">
      How we handle your details:{" "}
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
