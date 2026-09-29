"use client";

import { useEffect, useState } from "react";
import type { GetToken } from "@/lib/api/client";
import { fetchPrivateEventImage } from "@/lib/api/events";

/** Thumbnail of an event photo the reviewer can only fetch with their admin token. */
export default function PrivateEventImage({ imageUrl, getToken }: { imageUrl: string; getToken: GetToken }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchPrivateEventImage(imageUrl, getToken)
      .then((objectUrl) => {
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else {
          url = objectUrl;
          setSrc(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [imageUrl, getToken]);

  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- local object URL
  return <img src={src} alt="" className="mb-3 aspect-square w-32 object-cover" />;
}
