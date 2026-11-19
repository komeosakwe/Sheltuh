import { describe, expect, it } from "vitest";
import { formatOrganiserFieldValue, ORGANISER_FIELD_LABELS, ORGANISER_FIELD_ORDER } from "@/components/admin/organiser-fields";

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

  it("shows a cover's version as when it was uploaded, and chips as logged", () => {
    expect(formatOrganiserFieldValue("cover", "1761200000000")).toMatch(/^Uploaded /);
    expect(formatOrganiserFieldValue("cover", "not a version")).toBe("not a version");
    expect(formatOrganiserFieldValue("profileTags", "live-music, art")).toBe("live-music, art");
    expect(formatOrganiserFieldValue("customTags", "Drum & bass")).toBe("Drum & bass");
  });
});
