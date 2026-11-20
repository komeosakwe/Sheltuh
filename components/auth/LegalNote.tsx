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
    <p className="text-sm leading-5 text-muted">
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

/**
 * The account pages' one privacy line (the owner's iPhone screenshots, Round 2: said once, near the
 * actions): "By continuing you agree to the Terms of Use and Privacy Policy." Under /login's Apple
 * and Google buttons and under /signup's Sign up, covering the email form and the buttons alike.
 */
export function AgreeNote() {
  return (
    <p data-agree-note="" className="text-sm leading-5 text-muted">
      By continuing you agree to the{" "}
      <Link href="/terms" className="text-foreground underline underline-offset-4">
        Terms of Use
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="text-foreground underline underline-offset-4">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
