import { titleParts } from "@/components/home/home-content";

/**
 * A headline's text with only its marked letters drawn in the dotted face (Instrument Sans Dots).
 * `line` marks each dotted letter with a `^` before it ("What’s ^on."): the text, and so the
 * accessible name, stays plainly spelled, and only those letters get the brand's two dots. The
 * dotted face is for the wordmark and hero headlines, a letter or two each, never a whole sentence
 * (docs/design/brand-direction-one.md §3.3). Put it in an h1 that has `font-display display-plain`.
 */
export default function DottedLine({ line }: { line: string }) {
  return (
    <>
      {titleParts(line).map((part, i) =>
        part.dotted ? (
          <span key={i} data-dotted-letter="" className="font-dots">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
