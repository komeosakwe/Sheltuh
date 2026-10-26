"use client";

import { useEffect, useState } from "react";
import type { GetToken } from "@/lib/api/client";
import { fetchOrganiserLogo } from "@/lib/api/organisers";

type State = { url: string; objectUrl: string | null };

/**
 * An organiser's logo for an admin reviewing them, whatever their status
 * (it's only public while approved), fetched with the admin's token (an
 * <img> can't send one) and shown from an object URL, revoked when the logo
 * changes or the row leaves. While it loads it says so; if it can't be
 * fetched, it says that instead of showing nothing.
 */
export default function AdminOrganiserLogo({
  logoUrl,
  organiserName,
  getToken,
}: {
  logoUrl: string;
  organiserName: string;
  getToken: GetToken;
}) {
  const [loaded, setLoaded] = useState<State | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchOrganiserLogo(logoUrl, getToken, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ url: logoUrl, objectUrl });
      },
      () => {
        if (!controller.signal.aborted) setLoaded({ url: logoUrl, objectUrl: null });
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [logoUrl, getToken]);

  const current = loaded && loaded.url === logoUrl ? loaded : null;
  if (!current) return <span className="text-muted">Loading the logo…</span>;
  if (!current.objectUrl) return <span className="text-danger">Couldn&rsquo;t load the logo.</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL (the logo may need the admin's token)
    <img
      src={current.objectUrl}
      alt={`${organiserName}’s logo`}
      width={96}
      height={96}
      data-admin-organiser-logo=""
      className="size-24 rounded-dot border border-foreground bg-paper object-contain"
    />
  );
}
