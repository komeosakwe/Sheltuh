import type { CardGoing } from "@/lib/event-card";

/** One face in a card's going row: a member's photo where there is one, else a colour dot. */
export interface GoingFace {
  name: string;
  photoUrl?: string;
}

/** The dots' fills, in turn: black, orange (the brand's dot), grey. */
const DOT_FILLS = ["bg-foreground", "bg-signal", "bg-muted"] as const;

/**
 * An event card's going line (the rules' Cards board): a few small round
 * faces, overlapping, and "N going" on one line. Only ever with a count
 * (cardGoing: never under three). A face is the member's photo where the
 * payload has one, else a colour dot; there are no initials at this size.
 * The faces are decorative (the count says it). The demo's counts aren't
 * labelled here: the page's demo banner already says it's sample data.
 */
export default function GoingRow({
  going,
  faces,
  className = "",
}: {
  going: CardGoing;
  faces: readonly GoingFace[];
  className?: string;
}) {
  return (
    <p data-card-going="" className={`flex min-w-0 items-center gap-2 text-sm leading-5 font-semibold ${className}`.trim()}>
      {faces.length > 0 && (
        <span aria-hidden="true" data-card-faces="" className="flex shrink-0">
          {faces.map((face, i) => (
            <span
              key={`${face.name}-${i}`}
              data-card-face=""
              className={`flex size-5 shrink-0 overflow-hidden rounded-full ring-2 ring-background ${i > 0 ? "-ml-1.5" : ""} ${
                face.photoUrl ? "bg-surface" : DOT_FILLS[i % DOT_FILLS.length]
              }`.replace(/\s+/g, " ").trim()}
            >
              {face.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a 20px decorative face from the payload's own URL
                <img src={face.photoUrl} alt="" className="size-full object-cover" />
              )}
            </span>
          ))}
        </span>
      )}
      <span className="min-w-0 truncate tabular-nums">{going.count} going</span>
    </p>
  );
}
