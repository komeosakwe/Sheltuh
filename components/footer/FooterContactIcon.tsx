export type FooterContactKind = "linkedin" | "instagram" | "email";

/**
 * Contact Sheltüh's 24px line icons, drawn after Latte's 1120 footer ("Social icon": LinkedIn's "in"
 * inside a rounded square, Instagram, an envelope), in currentColor. Plain geometric marks, not the
 * brands' artwork. Decorative: the link around each one carries the name.
 */
export default function FooterContactIcon({ kind }: { kind: FooterContactKind }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      {kind === "linkedin" && (
        <>
          <rect x="1.75" y="1.25" width="20.5" height="21.25" rx="3.5" />
          <circle cx="7.25" cy="5.75" r="0.9" fill="currentColor" stroke="none" />
          <path d="M7.25 8.5v10M11.75 18.5v-10M11.75 12.25c0-2.3 1.5-3.75 3.1-3.75s2.9 1.2 2.9 3.4v6.6" />
        </>
      )}
      {kind === "instagram" && (
        <>
          <rect x="1.75" y="1.25" width="20.5" height="21.25" rx="5.5" />
          <circle cx="12" cy="12" r="4.75" />
          <circle cx="18.5" cy="5.25" r="0.9" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "email" && (
        <>
          <rect x="1.75" y="3.75" width="20.5" height="16.5" rx="2" />
          <path d="m2 5.5 10 7 10-7" />
        </>
      )}
    </svg>
  );
}
