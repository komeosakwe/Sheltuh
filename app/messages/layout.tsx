import type { Viewport } from "next";

// Phones: the on-screen keyboard shrinks the layout viewport (where browsers
// support it), so the conversation's sticky composer stays just above it.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default function MessagesLayout({ children }: LayoutProps<"/messages">) {
  return children;
}
