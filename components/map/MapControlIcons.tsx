/**
 * Line icons for /map's controls and location card (owner's mockup, 8 Nov 2026): 24-unit
 * outlines, 2-unit strokes, round ends. Decorative: the control's words say what it is.
 */

import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Outline({ className = "size-4", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <circle cx="11" cy="11" r="7.5" />
      <path d="m20.5 20.5-4.2-4.2" />
    </Outline>
  );
}

export function PinOutlineIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M12 21.5s-7-6.1-7-11.75a7 7 0 0 1 14 0C19 15.4 12 21.5 12 21.5Z" />
      <circle cx="12" cy="9.75" r="2.5" />
    </Outline>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="m6 9 6 6 6-6" />
    </Outline>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <rect x="3" y="4.5" width="18" height="17" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    </Outline>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="m12 2.5 9.5 5-9.5 5-9.5-5 9.5-5Z" />
      <path d="m2.5 12 9.5 5 9.5-5" />
      <path d="m2.5 16.5 9.5 5 9.5-5" />
    </Outline>
  );
}

export function TagIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" />
      <circle cx="7.5" cy="7.5" r="1.25" />
    </Outline>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M9 6h12M9 12h12M9 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </Outline>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Outline>
  );
}

export function ArrowUpRightIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Outline>
  );
}

/** A filled map pin: the Map view's icon. */
export function PinFilledIcon({ className = "size-4" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`}>
      <path
        fillRule="evenodd"
        d="M12 1.75a8 8 0 0 0-8 8c0 6.3 7.04 12.07 7.34 12.31a1.05 1.05 0 0 0 1.32 0C12.96 21.82 20 16.05 20 9.75a8 8 0 0 0-8-8Zm0 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      />
    </svg>
  );
}

/** The location arrow (filled), on the location card. */
export function NavigationIcon({ className = "size-4" }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`}>
      <path d="M21.3 2.7a1 1 0 0 0-1.1-.2L3.1 10.1a1 1 0 0 0 .1 1.86l7.2 2.04 1.94 7.25a1 1 0 0 0 1.88.13l7.3-17.5a1 1 0 0 0-.22-1.18Z" />
    </svg>
  );
}
