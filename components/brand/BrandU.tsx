/**
 * The brand's "ür" (docs/design/brand-direction-one.md §3.3): shown as "ÜR",
 * read by screen readers as "your". For brand lines only, never body copy,
 * buttons, labels or errors.
 */
export default function BrandU() {
  return (
    <>
      <span aria-hidden="true">ÜR</span>
      <span className="sr-only">your</span>
    </>
  );
}
