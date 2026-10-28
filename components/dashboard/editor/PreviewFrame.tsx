"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DotsLoader } from "@/components/brand/DotsMark";
import EventDetailsView from "@/components/EventDetailsView";
import { Button } from "@/components/ui/Button";
import type { SheltuhEvent } from "@/lib/types";
import type { PreviewMissing } from "./preview-event";

/** The page shell the preview renders into: the real event page, in its own document, so its media queries see the frame's width. */
const SRC_DOC =
  "<!doctype html><html lang='en'><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body></body></html>";

/** Stylesheets that haven't loaded in this long are a failed preview. */
const READY_TIMEOUT_MS = 5000;
/** Typing doesn't thrash the preview: it follows the draft this long after the last change. */
const UPDATE_DEBOUNCE_MS = 250;

type Phase = "loading" | "ready" | "error";

/** A render error inside the preview must not take the editor with it. */
class PreviewBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Copies the editor page's look into the frame: its fonts and stylesheets, the theme and the body classes. */
function copyPageStyles(frame: Document): Promise<void> {
  const root = frame.documentElement;
  root.className = document.documentElement.className;
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) root.setAttribute("data-theme", theme);
  frame.body.className = document.body.className;
  const loads: Promise<void>[] = [];
  for (const node of document.head.querySelectorAll<HTMLElement>("link[rel='stylesheet'], style")) {
    const copy = node.cloneNode(true) as HTMLElement;
    if (copy instanceof HTMLLinkElement) {
      loads.push(
        new Promise((resolve) => {
          copy.addEventListener("load", () => resolve(), { once: true });
          copy.addEventListener("error", () => resolve(), { once: true });
        }),
      );
    }
    frame.head.appendChild(copy);
  }
  return Promise.all(loads).then(() => undefined);
}

/**
 * The editor's live preview (docs/design/event-editor.md §5.10): the real event page rendering the draft, in a
 * same-document `srcdoc` iframe through a portal (no route, no framing-header change). The page's layout is
 * driven by viewport media queries, so the iframe's own width is what makes 320px a phone. The page's styles
 * and theme are copied in, and the theme follows the editor's. The whole preview is `inert`: nothing in it
 * is focusable or clickable. It follows the draft on a short debounce.
 */
export default function PreviewFrame({
  event,
  missing,
  className = "",
}: {
  event: SheltuhEvent;
  missing: PreviewMissing;
  /** The iframe's size and position. */
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [shown, setShown] = useState({ event, missing });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ event, missing });
  useEffect(() => {
    latest.current = { event, missing };
  });

  // The draft, a moment after it last changed (the first one straight away).
  const draftKey = JSON.stringify({ event, missing });
  useEffect(() => {
    const timer = setTimeout(() => setShown(latest.current), UPDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftKey]);

  const prepare = useCallback(() => {
    const frame = frameRef.current?.contentDocument;
    if (!frame || !frame.body) return;
    let alive = true;
    const timeout = setTimeout(() => alive && setPhase((p) => (p === "loading" ? "error" : p)), READY_TIMEOUT_MS);
    copyPageStyles(frame).then(() => {
      if (!alive) return;
      clearTimeout(timeout);
      setBody(frame.body);
      setPhase((p) => (p === "error" ? p : "ready"));
    });
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, []);

  // Light / Dark follows the editor page.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const frame = frameRef.current?.contentDocument;
      if (!frame) return;
      const theme = root.getAttribute("data-theme");
      if (theme) frame.documentElement.setAttribute("data-theme", theme);
      else frame.documentElement.removeAttribute("data-theme");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function retry() {
    setBody(null);
    setPhase("loading");
    setAttempt((n) => n + 1);
  }

  return (
    <div className="relative">
      <iframe
        key={attempt}
        ref={frameRef}
        title="Event page preview"
        srcDoc={SRC_DOC}
        tabIndex={-1}
        onLoad={prepare}
        className={`block border-0 ${className}`.trim()}
      />
      {body &&
        createPortal(
          <PreviewBoundary key={attempt} onError={() => setPhase("error")}>
            <div inert data-event-preview="">
              <EventDetailsView event={shown.event} demo={false} preview={{ missing: shown.missing }} />
            </div>
          </PreviewBoundary>,
          body,
        )}
      {phase === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <DotsLoader announce label="Loading preview" />
        </div>
      )}
      {phase === "error" && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-4 text-center">
          <p className="text-sm text-foreground">Couldn&rsquo;t load the preview.</p>
          <Button variant="outline" size="sm" className="min-h-11" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
