"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text for a visually hidden live region that's mounted once and never
 * unmounted (§5.A8). To repeat identical text, it's cleared and then set
 * again on the next animation frame, so screen readers speak it again.
 */
export function useAnnouncer(): [string, (text: string) => void] {
  const [text, setText] = useState("");
  const frame = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const announce = useCallback((next: string) => {
    setText("");
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      setText(next);
    });
  }, []);

  return [text, announce];
}
