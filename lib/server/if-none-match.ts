/**
 * If-None-Match (RFC 9110 §13.1.2) for the image routes (event images,
 * organiser logos and covers). The header is `*` or a comma-separated list
 * of entity tags, each optionally weak (`W/"…"`); If-None-Match uses the weak
 * comparison, so `W/` is dropped and only the opaque tag counts.
 *
 * Conservative by design: anything that isn't exactly that grammar, or that
 * is longer than MAX_IF_NONE_MATCH_LENGTH or lists more than
 * MAX_IF_NONE_MATCH_TAGS tags, counts as no match at all, so the worst a
 * malformed or abusive header gets is the full 200 it would have got anyway.
 */

/** Longer headers are ignored (no match). Header values are byte strings, so this is bytes. */
export const MAX_IF_NONE_MATCH_LENGTH = 1024;
/** Headers listing more tags than this are ignored (no match). */
export const MAX_IF_NONE_MATCH_TAGS = 32;

/**
 * What an If-None-Match header claims: `"*"` (any current representation),
 * or the opaque tags it lists, without their quotes or `W/`, in order (empty:
 * no header, or one that's ignored).
 */
export type IfNoneMatch = "*" | readonly string[];

const NONE: readonly string[] = Object.freeze([]);

/** etagc: %x21 / %x23-7E / obs-text (%x80-FF). No DQUOTE, no whitespace, no controls. */
const OPAQUE_TAG = /^[\x21\x23-\x7e\x80-\xff]*$/;

function isOws(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/** Parses an If-None-Match header value (null: no header). */
export function parseIfNoneMatch(header: string | null): IfNoneMatch {
  if (header === null || header.length > MAX_IF_NONE_MATCH_LENGTH) return NONE;
  if (header.trim() === "*") return "*";

  const tags: string[] = [];
  let i = 0;
  for (;;) {
    while (isOws(header[i])) i++;
    if (i >= header.length) break;
    // The list rule allows empty elements (`, ,"a"`); skip them.
    if (header[i] === ",") {
      i++;
      continue;
    }
    if (header.startsWith("W/", i)) i += 2;
    if (header[i] !== '"') return NONE;
    // The opaque tag runs to the next quote: a comma inside it is part of the tag.
    const close = header.indexOf('"', i + 1);
    if (close === -1) return NONE;
    const tag = header.slice(i + 1, close);
    if (!OPAQUE_TAG.test(tag)) return NONE;
    tags.push(tag);
    if (tags.length > MAX_IF_NONE_MATCH_TAGS) return NONE;
    i = close + 1;
    while (isOws(header[i])) i++;
    if (i < header.length && header[i] !== ",") return NONE;
  }
  return tags;
}

/**
 * The request's If-None-Match, read for a route whose ETags are
 * `"<version><suffix>"` (a version of digits, as the image routes make it).
 * `any` is a `*`; `versions` are the versions of the listed tags that have
 * exactly this suffix (other tags can never match). The route passes both to
 * its query, which skips reading the image when the current version is
 * claimed (`$any or version = any($versions)`), and answers 304 when it did,
 * always after its access check.
 */
export function claimedVersions(req: Request, suffix = ""): { any: boolean; versions: string[] } {
  const claim = parseIfNoneMatch(req.headers.get("if-none-match"));
  if (claim === "*") return { any: true, versions: [] };
  const versions: string[] = [];
  for (const tag of claim) {
    if (!tag.endsWith(suffix)) continue;
    const version = tag.slice(0, tag.length - suffix.length);
    if (/^\d{1,20}$/.test(version) && !versions.includes(version)) versions.push(version);
  }
  return { any: false, versions };
}
