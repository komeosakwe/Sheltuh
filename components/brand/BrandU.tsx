import type { ReactNode } from "react";

/**
 * A brand line with the brand's "ür" (docs/design/brand-direction-one.md
 * §3.3): `children` is the line as shown ("WHERE IS ÜR SHELTÜH?"), hidden
 * from screen readers; `spoken` is the whole plain sentence they read
 * instead ("Where is your Sheltüh?"), in one span so it's read as one
 * phrase, not in pieces. For brand lines only, never body copy, buttons,
 * labels or errors.
 */
export default function BrandU({ spoken, children }: { spoken: string; children: ReactNode }) {
  return (
    <>
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}
