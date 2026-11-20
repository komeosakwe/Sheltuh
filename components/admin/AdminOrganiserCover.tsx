"use client";

import { useEffect, useState } from "react";
import type { GetToken } from "@/lib/api/client";
import { fetchOrganiserCover } from "@/lib/api/organisers";

type State = { url: string; objectUrl: string | null };

/**
 * An organiser's cover photo for an admin reviewing them, whatever their
 * status (it's only public while approved), as AdminOrganiserLogo: fetched
 * with the admin's token (the small, 1120 px one) and shown from an object
 * URL, revoked when the cover changes or the row leaves. While it loads it
 * says so; if it can't be fetched, it says that instead of showing nothing.
 */
export default function AdminOrganiserCover({
  coverUrl,
  organiserName,
  getToken,
}: {
  /** `coverSmallUrl` (or `coverUrl`) from the record. */
  coverUrl: string;
  organiserName: string;
  getToken: GetToken;
}) {
  const [loaded, setLoaded] = useState<State | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchOrganiserCover(coverUrl, getToken, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ url: coverUrl, objectUrl });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ url: coverUrl, objectUrl: null });
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverUrl, getToken]);

  const current = loaded && loaded.url === coverUrl ? loaded : null;
  if (!current) return <span className="text-muted">Loading the cover photo…</span>;
  if (!current.objectUrl) return <span className="text-danger">Couldn&rsquo;t load the cover photo.</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL (the cover may need the admin's token)
    <img
      src={current.objectUrl}
      alt={`${organiserName}’s cover photo`}
      width={1120}
      height={320}
      data-admin-organiser-cover=""
      className="aspect-7/2 w-full max-w-sm rounded-control border border-foreground bg-surface object-cover"
    />
  );
}
