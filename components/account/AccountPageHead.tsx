import type { ReactNode } from "react";

/**
 * An account page's title block (Latte's 1120 frames, "Page title"): the h1 in Heading/H1 40/48 at
 * every width, and one line under it in Body/M text/secondary, 4px apart. `action` sits at the
 * right, level with the line's foot (wrapping under it on a phone). `tall`: the Settings head, which
 * the frames draw 100px tall at 768 and up (its empty "Actions" box), so the title sits lower.
 */
export default function AccountPageHead({
  title,
  intro,
  action,
  tall = false,
  as: Title = "h1",
}: {
  /** "p" where something else on the page is its h1 (a conversation: the other person's name). */
  as?: "h1" | "p";
  title: string;
  intro?: ReactNode;
  action?: ReactNode;
  tall?: boolean;
}) {
  return (
    <div
      data-account-head=""
      className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${tall ? "md:min-h-25" : ""}`.trim()}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Title className="heading-page break-words">{title}</Title>
        {intro && <p className="body-m text-muted">{intro}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
