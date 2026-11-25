"use client";

import { createContext, useContext } from "react";

/** Which dashboard frame (DashFrame) a component is inside: "account", "organiser", or null outside both. */
export type DashArea = "account" | "organiser";

export const DashFrameContext = createContext<DashArea | null>(null);

/**
 * The frame around this component, if any. Inside a frame the page's column is narrower than the
 * window (the 264px sidebar, the frame's margins), so wide layouts keyed to the window's width
 * check this too: the event editor keeps its preview in a sheet there (editor/PreviewPanel.tsx).
 */
export function useDashFrame(): DashArea | null {
  return useContext(DashFrameContext);
}
