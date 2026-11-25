import type { ReactNode, Ref } from "react";

/**
 * An account page's title block (Latte's 1120 frames, "Page title"): the h1 in Heading/H1 40/48 at
 * every width, and one line under it in Body/M text/secondary, 4px apart. `action` sits at the
 * right, level with the line's foot (wrapping under it on a phone). `tall`: the Settings head, which
 * the frames draw 100px tall at 768 and up (its empty "Actions" box), so the title sits lower.
 * `tightOnPhone`: no gap between the words and the action below 640px (the organiser Events tab's
 * Create event sits right under its line on the 390 frame). `titleRef`: the h1 can take focus from
 * script (tabIndex -1, no ring: it isn't a control).
 */
export default function AccountPageHead({
  title,
  intro,
  action,
  tall = false,
  tightOnPhone = false,
  titleRef,
  as: Title = "h1",
}: {
  /** "p" where something else on the page is its h1 (a conversation: the other person's name). */
  as?: "h1" | "p";
  title: string;
  intro?: ReactNode;
  action?: ReactNode;
  tall?: boolean;
  tightOnPhone?: boolean;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div
      data-account-head=""
      className={`flex flex-col sm:flex-row sm:items-end sm:justify-between ${tightOnPhone ? "gap-0 sm:gap-3" : "gap-3"} ${tall ? "md:min-h-25" : ""}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {Title === "h1" && titleRef ? (
          <h1 ref={titleRef} tabIndex={-1} className="heading-page break-words focus:outline-none!">
            {title}
          </h1>
        ) : (
          <Title className="heading-page break-words">{title}</Title>
        )}
        {intro && <p className="body-m text-muted">{intro}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
