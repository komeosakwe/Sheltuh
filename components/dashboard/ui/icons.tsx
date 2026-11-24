import type { ReactNode } from "react";

/**
 * The dashboard's 24px line icons (Latte's dashboard frames, Components 465:7337: "Icons ·
 * Dashboard nav" and "Icons · Panel (dark)"), redrawn as inline SVG from the frames (the Figma
 * assets can't be downloaded here). One stroke (1.75 on the 24 grid, as drawn) in the text colour,
 * so the same icon is white on the ink rail and black on a panel. Always decorative (aria-hidden):
 * the label beside the icon, or the control's own name, carries the meaning.
 */
function icon(paths: ReactNode, displayName: string) {
  function Icon({ className = "size-6" }: { className?: string }) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`shrink-0 ${className}`.trim()}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// "Icons · Dashboard nav" (on ink): the sidebar's rail, Log out and the drawer's » / «.
export const UserIcon = icon(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
  "UserIcon",
);
export const TicketIcon = icon(
  <>
    <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z" />
    <path d="M14 10v4" />
  </>,
  "TicketIcon",
);
export const HeartIcon = icon(
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  "HeartIcon",
);
export const MessageIcon = icon(<path d="M4 4h16v12H8l-4 4Z" />, "MessageIcon");
export const GridIcon = icon(
  <>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </>,
  "GridIcon",
);
export const CalendarIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </>,
  "CalendarIcon",
);
export const ReceiptIcon = icon(
  <>
    <path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z" />
    <path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" />
  </>,
  "ReceiptIcon",
);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
  </>,
  "UsersIcon",
);
export const WalletIcon = icon(
  <>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18M16 15h2" />
  </>,
  "WalletIcon",
);
export const SettingsIcon = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </>,
  "SettingsIcon",
);
export const LogOutIcon = icon(
  <>
    <path d="M10 4H5v16h5" />
    <path d="M15 8l4 4-4 4M19 12H9" />
  </>,
  "LogOutIcon",
);
export const ExpandIcon = icon(<path d="m6 7 5 5-5 5M13 7l5 5-5 5" />, "ExpandIcon");
export const CollapseIcon = icon(<path d="m18 7-5 5 5 5M11 7l-5 5 5 5" />, "CollapseIcon");

// "Icons · Panel (dark)": the Manage panel's field rows, options and menus.
export const PinIcon = icon(
  <>
    <path d="M19 10c0 5-7 11-7 11s-7-6-7-11a7 7 0 0 1 14 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,
  "PinIcon",
);
export const HostIcon = icon(<path d="M3 7.5 7.5 12 12 6l4.5 6L21 7.5V18H3Z" />, "HostIcon");
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
  "GlobeIcon",
);
export const FeeIcon = icon(
  <>
    <path d="M18 6 6 18" />
    <circle cx="7" cy="7" r="1.5" />
    <circle cx="17" cy="17" r="1.5" />
  </>,
  "FeeIcon",
);
export const RefundIcon = icon(
  <>
    <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </>,
  "RefundIcon",
);
export const AgeIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="12" r="2" />
    <path d="M14 10h4M14 14h4" />
  </>,
  "AgeIcon",
);
export const EyeIcon = icon(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
  "EyeIcon",
);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />, "ChevronDownIcon");
export const CheckIcon = icon(<path d="M5 12.5 10 17.5 19 7" />, "CheckIcon");
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />, "PlusIcon");
export const MoreIcon = icon(<path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.75} />, "MoreIcon");
export const PencilIcon = icon(
  <path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />,
  "PencilIcon",
);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />, "CloseIcon");
