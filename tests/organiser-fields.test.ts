import { describe, expect, it } from "vitest";
import {
  emptyOrganiserFieldValue,
  formatOrganiserFieldValue,
  ORGANISER_FIELD_LABELS,
  ORGANISER_FIELD_ORDER,
} from "@/components/admin/organiser-fields";

/** The admin queue's organiser log lists only ORGANISER_FIELD_ORDER's fields, so a field missing there is a blank entry. */
describe("organiser log fields", () => {
  it("lists every field the log can name, each with a label", () => {
    expect([...ORGANISER_FIELD_ORDER].sort()).toEqual(Object.keys(ORGANISER_FIELD_LABELS).sort());
    expect(new Set(ORGANISER_FIELD_ORDER).size).toBe(ORGANISER_FIELD_ORDER.length);
    for (const field of ["cover", "profileTags", "customTags"] as const) expect(ORGANISER_FIELD_ORDER).toContain(field);
  });

  it("names the profile chips apart from the reviewed event categories", () => {
    expect(ORGANISER_FIELD_LABELS.profileTags).toBe("Profile categories");
    expect(ORGANISER_FIELD_LABELS.customTags).toBe("Own words");
  });

  it("shows a cover's version as when it was uploaded, list chips as their labels, own words as logged", () => {
    expect(ORGANISER_FIELD_LABELS.cover).toBe("Cover photo");
    expect(formatOrganiserFieldValue("cover", "1761200000000")).toMatch(/^Uploaded /);
    expect(formatOrganiserFieldValue("cover", "not a version")).toBe("not a version");
    expect(formatOrganiserFieldValue("profileTags", "live-music, poetry-spoken-word")).toBe("Live music, Poetry & spoken word");
    // A slug this build doesn't know stays as stored.
    expect(formatOrganiserFieldValue("profileTags", "art, ghost-tag")).toBe("Art, ghost-tag");
    // Own words in quotes, as the row above the log shows them, so a stray space shows.
    expect(formatOrganiserFieldValue("customTags", "Drum & bass")).toBe("“Drum & bass”");
    expect(formatOrganiserFieldValue("customTags", "Late night , Queer joy")).toBe("“Late night ”, “Queer joy”");
  });

  it("says 'not chosen' and 'none chosen' for profile chips, and (none) for anything else unset", () => {
    expect(emptyOrganiserFieldValue("profileTags", null)).toMatch(/^Not chosen yet/);
    expect(emptyOrganiserFieldValue("profileTags", "")).toBe("None chosen");
    expect(emptyOrganiserFieldValue("profileTags", "art")).toBeNull();
    expect(emptyOrganiserFieldValue("customTags", null)).toBe("(none)");
    expect(emptyOrganiserFieldValue("customTags", "")).toBe("(none)");
    expect(emptyOrganiserFieldValue("description", null)).toBe("(none)");
    expect(emptyOrganiserFieldValue("description", "Hi")).toBeNull();
  });
});
