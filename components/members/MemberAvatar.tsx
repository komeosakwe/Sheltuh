"use client";

import { useEffect, useRef, useState } from "react";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import type { GetToken } from "@/lib/api/client";
import { useAvatarObjectUrl } from "./useAvatarObjectUrl";

const SIZE_CLASS = { md: "size-8", lg: "size-24 sm:size-32" } as const;

/**
 * A member's photo in the avatar's rounded square (brand-direction-one.md
 * §2.4), or their initials when there's none, it can't be seen or it hasn't
 * loaded yet. Decorative (`alt=""`): the name beside it is what's read.
 *
 * `lazy`: fetched only once it scrolls near the viewport (a long Who's Going
 * list fetches only the rows people see).
 */
export default function MemberAvatar({
  name,
  url,
  getToken,
  size = "md",
  index = 0,
  lazy = false,
}: {
  name: string;
  /** `avatarUrl` / `avatarThumbUrl` from the API; unset: initials. */
  url?: string;
  getToken?: GetToken;
  size?: keyof typeof SIZE_CLASS;
  /** The row's place in its list, for the initials' fill. */
  index?: number;
  lazy?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || !url) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      // Nothing to watch with: load it now rather than never.
      queueMicrotask(() => setVisible(true));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, url]);

  const src = useAvatarObjectUrl(url, getToken, visible);

  return (
    <span ref={ref} aria-hidden="true" className={`flex shrink-0 ${SIZE_CLASS[size]}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL (the photo needs the bearer token)
        <img src={src} alt="" data-member-photo="" className="size-full rounded-dot object-cover" />
      ) : (
        <InitialsAvatar name={name} index={index} size={size} />
      )}
    </span>
  );
}
