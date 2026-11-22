import type { Viewport } from "next";
import MessagesFrame from "@/components/messages/MessagesFrame";

// Phones: the on-screen keyboard shrinks the layout viewport (where browsers
// support it), so the conversation's sticky composer stays just above it.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

/** The conversation list beside the open conversation (components/messages/MessagesFrame.tsx). */
export default function MessagesLayout({ children }: LayoutProps<"/messages">) {
  return <MessagesFrame>{children}</MessagesFrame>;
}
