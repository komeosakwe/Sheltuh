import InitialsAvatar from "@/components/ui/InitialsAvatar";
import type { CardGoing } from "@/lib/event-card";

/**
 * An event card's going line (the rules' Cards board): a few round faces
 * and "N going". Only ever with a count (cardGoing: never under three). The
 * faces are the demo's sample names as initials (cardGoingFaces), and none
 * live, where list payloads carry no names or photos; they're decorative,
 * the count says it. A demo count is labelled "(sample)".
 */
export default function GoingRow({
  going,
  faces,
  className = "",
}: {
  going: CardGoing;
  faces: readonly string[];
  className?: string;
}) {
  return (
    <p data-card-going="" className={`flex min-w-0 items-center gap-2 text-sm leading-5 font-semibold ${className}`.trim()}>
      {faces.length > 0 && (
        <span aria-hidden="true" data-card-faces="" className="flex shrink-0">
          {faces.map((name, i) => (
            <span key={`${name}-${i}`} className={`flex rounded-full ring-2 ring-background ${i > 0 ? "-ml-0.5" : ""}`.trim()}>
              <InitialsAvatar name={name} index={i} size="xs" />
            </span>
          ))}
        </span>
      )}
      <span className="min-w-0 tabular-nums">
        {going.count} going
        {going.sample && <span className="font-normal text-muted"> (sample)</span>}
      </span>
    </p>
  );
}
