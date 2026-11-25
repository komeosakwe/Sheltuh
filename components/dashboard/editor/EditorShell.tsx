import type { ReactNode } from "react";

/**
 * The editor's columns (docs/design/event-editor.md §3): one column below `col-lg` (1024px, or 1280px inside the
 * organiser dashboard's frame, whose page column is narrower: globals.css); from there the rail (the summary and the
 * steps, sticky on viewports 48rem tall or more: on a shorter one it would sit under the save bar) beside the main
 * column; from xl the preview panel as a third column (not inside the organiser frame: editor/PreviewPanel.tsx). Flex,
 * so the main column takes what's left (592px at 1280 with the panel, 768px at most without it).
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
    <div className="flex flex-col gap-6 col-lg:flex-row col-lg:items-start col-lg:gap-8">
      <div className="flex flex-col gap-4 col-lg:w-52 col-lg:shrink-0 col-lg:gap-6 col-lg:[@media(min-height:48rem)]:sticky col-lg:[@media(min-height:48rem)]:top-(--header-h)">{rail}</div>
      <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-4 sm:gap-6 col-lg:max-w-3xl">{children}</div>
      {preview}
    </div>
  );
}
