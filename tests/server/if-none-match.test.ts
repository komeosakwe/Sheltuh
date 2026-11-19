import { describe, expect, it } from "vitest";
import {
  claimedVersions,
  MAX_IF_NONE_MATCH_LENGTH,
  MAX_IF_NONE_MATCH_TAGS,
  parseIfNoneMatch,
} from "@/lib/server/if-none-match";

// If-None-Match, RFC 9110 §13.1.2: `*` or a list of (possibly weak) entity tags.

describe("parseIfNoneMatch", () => {
  it("no header, or an empty one, claims nothing", () => {
    expect(parseIfNoneMatch(null)).toEqual([]);
    expect(parseIfNoneMatch("")).toEqual([]);
    expect(parseIfNoneMatch("  ")).toEqual([]);
  });

  it("reads one tag, and a list (with optional whitespace and empty elements)", () => {
    expect(parseIfNoneMatch(`"123-l"`)).toEqual(["123-l"]);
    expect(parseIfNoneMatch(`"122-l", "123-l"`)).toEqual(["122-l", "123-l"]);
    expect(parseIfNoneMatch(`"a","b"`)).toEqual(["a", "b"]);
    expect(parseIfNoneMatch(` \t"a" ,\t"b"  `)).toEqual(["a", "b"]);
    expect(parseIfNoneMatch(`, ,"a",,"b",`)).toEqual(["a", "b"]);
    // An empty opaque tag is a tag.
    expect(parseIfNoneMatch(`""`)).toEqual([""]);
  });

  it("splits on commas only outside the quotes", () => {
    expect(parseIfNoneMatch(`"a,b", "c"`)).toEqual(["a,b", "c"]);
    expect(parseIfNoneMatch(`",", W/",x,"`)).toEqual([",", ",x,"]);
  });

  it("drops W/ (If-None-Match uses the weak comparison)", () => {
    expect(parseIfNoneMatch(`W/"123-l"`)).toEqual(["123-l"]);
    expect(parseIfNoneMatch(`W/"122-l", "123-l", W/"124"`)).toEqual(["122-l", "123-l", "124"]);
  });

  it("reads `*` as a wildcard, but a quoted * is just a tag", () => {
    expect(parseIfNoneMatch("*")).toBe("*");
    expect(parseIfNoneMatch(" * ")).toBe("*");
    expect(parseIfNoneMatch(`"*"`)).toEqual(["*"]);
  });

  it("ignores anything that isn't the grammar: the whole header claims nothing", () => {
    for (const junk of [
      "123-l", // unquoted
      `"123-l`, // unterminated
      `123-l"`,
      `"a" "b"`, // no comma
      `"a"x`,
      `w/"a"`, // W/ is case-sensitive
      `W/ "a"`,
      `W/a`,
      `*, "a"`, // `*` is only ever alone
      `"a", *`,
      "**",
      `"a b"`, // whitespace isn't an etagc
      `"a\tb"`,
      `"a", junk, "b"`,
      `"a\u0001"`, // a control character
    ]) {
      expect([junk, parseIfNoneMatch(junk)]).toEqual([junk, []]);
    }
  });

  it("accepts obs-text (bytes 0x80-0xFF) in a tag", () => {
    expect(parseIfNoneMatch(`"café"`)).toEqual(["café"]);
  });

  it(`ignores a header over ${MAX_IF_NONE_MATCH_LENGTH} bytes or ${MAX_IF_NONE_MATCH_TAGS} tags`, () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `"${i}"`).join(",");
    expect(parseIfNoneMatch(tags(MAX_IF_NONE_MATCH_TAGS))).toHaveLength(MAX_IF_NONE_MATCH_TAGS);
    expect(parseIfNoneMatch(tags(MAX_IF_NONE_MATCH_TAGS + 1))).toEqual([]);

    const atLimit = `"${"x".repeat(MAX_IF_NONE_MATCH_LENGTH - 2)}"`;
    expect(atLimit).toHaveLength(MAX_IF_NONE_MATCH_LENGTH);
    expect(parseIfNoneMatch(atLimit)).toEqual(["x".repeat(MAX_IF_NONE_MATCH_LENGTH - 2)]);
    expect(parseIfNoneMatch(`${atLimit} `)).toEqual([]);
    // Padding a `*` past the limit doesn't make it a wildcard either.
    expect(parseIfNoneMatch(`*${" ".repeat(MAX_IF_NONE_MATCH_LENGTH)}`)).toEqual([]);
  });

  it("a long run of commas is an empty list; a run of quotes is junk", () => {
    expect(parseIfNoneMatch(",".repeat(MAX_IF_NONE_MATCH_LENGTH))).toEqual([]);
    expect(parseIfNoneMatch(`"`.repeat(MAX_IF_NONE_MATCH_LENGTH))).toEqual([]);
    expect(parseIfNoneMatch(`""""`)).toEqual([]);
  });
});

describe("claimedVersions", () => {
  const req = (header?: string) =>
    new Request("https://sheltuh.test/api/test", { headers: header === undefined ? {} : { "if-none-match": header } });

  it("keeps the versions of the tags with this suffix, deduplicated", () => {
    expect(claimedVersions(req(`"122-l", W/"123-l", "123-s", "124-f", "123-l"`), "-l")).toEqual({
      any: false,
      versions: ["122", "123"],
    });
    expect(claimedVersions(req(`"122-l", W/"123-s"`), "-s")).toEqual({ any: false, versions: ["123"] });
  });

  it("with no suffix, only bare versions", () => {
    expect(claimedVersions(req(`"5", "6-l", W/"7", "x8", "", "${"9".repeat(21)}"`))).toEqual({
      any: false,
      versions: ["5", "7"],
    });
  });

  it("`*` is any; no header or junk is nothing", () => {
    expect(claimedVersions(req("*"), "-l")).toEqual({ any: true, versions: [] });
    expect(claimedVersions(req(), "-l")).toEqual({ any: false, versions: [] });
    expect(claimedVersions(req("123-l"), "-l")).toEqual({ any: false, versions: [] });
  });

  it("reads If-None-Match sent as several header lines as one list", () => {
    const headers = new Headers();
    headers.append("if-none-match", `"1-l"`);
    headers.append("if-none-match", `"2-l"`);
    expect(claimedVersions(new Request("https://sheltuh.test/api/test", { headers }), "-l")).toEqual({
      any: false,
      versions: ["1", "2"],
    });
  });
});
