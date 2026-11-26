import Wordmark from "@/components/brand/Wordmark";
import { SIGN_PAPER_LABEL, type SignPaper, type SignText } from "@/lib/qr-sign";
import LinkQrImage from "./LinkQrImage";

/**
 * The printable sign (docs/architecture.md, "Event QR codes"): one portrait
 * A4 or A5 sheet with the Sheltüh wordmark, the event's title, its date and
 * time in its own zone, the venue and suburb, the code (large, as vector) and
 * what scanning does, then the short address. White paper and black ink in
 * every theme, so it prints the same on any printer. The layout is in
 * globals.css (`.qr-sign`), sized in container units, so the preview is the
 * printed page at any width; printing shows the sheet alone (`data-print-sheet`).
 *
 * Every word is React text (the organiser's title and venue included), so
 * nothing they typed is ever read as markup.
 */
export default function EventQrSign({ text, matrix, paper }: { text: SignText; matrix: boolean[][]; paper: SignPaper }) {
  return (
    <section
      data-print-sheet=""
      data-paper={paper}
      aria-label={`Sign preview, ${SIGN_PAPER_LABEL[paper]}`}
      className="qr-sign border border-foreground print:border-0"
    >
      <div className="qr-sign-body">
        <Wordmark label="Sheltüh" className="qr-sign-wordmark" />
        <h2 className="qr-sign-title" data-size={text.titleSize}>
          {text.title}
        </h2>
        <div className="qr-sign-details">
          <p className="qr-sign-when">{text.when}</p>
          <p className="qr-sign-zone">{text.zone}</p>
          {text.place && <p className="qr-sign-place">{text.place}</p>}
        </div>
        <div className="qr-sign-code">
          {/* Just "QR code": the address it opens is printed right under it. */}
          <LinkQrImage matrix={matrix} label="QR code" />
        </div>
        <p className="qr-sign-action">{text.action}</p>
        <p className="qr-sign-address">{text.address}</p>
      </div>
    </section>
  );
}
