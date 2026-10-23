"use client";

import { useEffect, useState } from "react";
import type { GetToken } from "@/lib/api/client";
import { fetchAvatar } from "@/lib/api/profiles";

/**
 * A member photo as a blob URL. Photos are never public, so they're fetched
 * with the bearer token (lib/api/profiles.ts `fetchAvatar`) and shown from an
 * object URL, revoked when the photo changes or the component unmounts.
 * `null` while loading, when there's nothing to load (`url` unset, or not
 * `enabled` yet: e.g. a row that hasn't scrolled into view), or when it can't
 * be seen (the caller shows initials instead). A failure is only ever a
 * fallback to initials: the photo is decoration beside the name.
 */
export function useAvatarObjectUrl(url: string | undefined, getToken: GetToken | undefined, enabled = true) {
  const [loaded, setLoaded] = useState<{ url: string; objectUrl: string | null } | null>(null);

  useEffect(() => {
    if (!url || !getToken || !enabled) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchAvatar(url, getToken, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ url, objectUrl });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ url, objectUrl: null });
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, getToken, enabled]);

  return loaded && loaded.url === url ? loaded.objectUrl : null;
}
