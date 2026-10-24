import { titleParts } from "@/components/home/home-content";

/**
 * A title with `^`-marked letters drawn in the dotted face (`font-dots`): the rest is plain, and
 * there's no whitespace between the runs, so the text and accessible name are exactly the plain
 * words (`titleText`).
 */
export default function DottedText({ text }: { text: string }) {
  return (
    <>
      {titleParts(text).map((part, i) =>
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
