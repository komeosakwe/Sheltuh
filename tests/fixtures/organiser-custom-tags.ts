/**
 * Own words that parseCustomTag (lib/api/organiser-tags.ts) accepts, by the
 * unit test that checks them (tests/organiser-tags.test.ts). The API–database
 * parity test (tests/server/organiser-tags.test.ts) checks that every one of
 * them, as the API cleans it, also passes private.organiser_custom_tag_ok, so
 * a word the API takes is never a 500 at the database.
 */
export const ACCEPTED_CUSTOM_TAGS = {
  scripts: [
    "Jazz",
    "DJ",
    "Rock 'n' roll",
    "Rock ’n’ roll",
    "Late-night",
    "Ngā toi",
    "日本のジャズ",
    "Class of 2024",
    "Unofficial",
    "Partnership",
    "Featuring friends",
    "Approval votes",
  ],
  cleaned: ["  Drum  　 &\tbass ", "Café"],
  lengths: ["Ab", "a".repeat(24), "\u{20000}\u{20001}"],
  digits: ["1234 club"],
  marks: ["Việt", "q́̀ab"],
  wholeWordsOnly: ["Unofficial", "Partnership", "Approvals", "Promotional", "Unverified gossip", "Holdout", "Gold outfits"],
  oneScriptPerWord: ["Русский рок", "Ελληνικά", "Jazz джаз", "日本のジャズ"],
  ordinary: [
    "Illustration",
    "Film nights",
    "Hip hop",
    "Café",
    "Aboriginal art",
    "K-pop",
    "Modern art",
    "Lo-fi",
    "Soul food",
    "Indie folk",
    "Oil painting",
    "Billboard hits",
    "McDonald",
    "iPhone art",
    "DnB",
    "RnB",
    "Spoken word",
    "Ölfarben",
  ],
} as const satisfies Record<string, readonly string[]>;

export const ALL_ACCEPTED_CUSTOM_TAGS: readonly string[] = Object.values(ACCEPTED_CUSTOM_TAGS).flat();
