import type { ReactNode } from "react";

/**
 * The editor's columns (docs/design/event-editor.md §3): one column below lg; from lg the rail (the summary and
 * the steps, sticky on viewports 48rem tall or more: on a shorter one it would sit under the save bar) beside the main column; from xl the preview panel as a third column. Flex, so the main
 * column takes what's left (592px at 1280 with the panel, 768px at most without it).
 */
export default function EditorShell({
  rail,
  children,
  preview,
}: {
  rail: ReactNode;
  children: ReactNode;
  /** The xl preview panel (renders nothing below xl). */
  preview: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex flex-col gap-4 lg:w-52 lg:shrink-0 lg:gap-6 lg:[@media(min-height:48rem)]:sticky lg:[@media(min-height:48rem)]:top-24">{rail}</div>
      <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-4 sm:gap-6 lg:max-w-3xl">{children}</div>
      {preview}
    </div>
  );
}
