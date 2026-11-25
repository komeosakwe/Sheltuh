import { describe, expect, it } from "vitest";
import type { OrganiserStatus } from "@/lib/api/types";
import { isKnownOrganiser, organisersHref, type OrganiserLoad } from "@/lib/organiser-nav";

/**
 * Where the site's own "For organisers" links go (the header, the phone drawer, the footer): an
 * approved organiser straight to /dashboard, everyone else to the For organisers page. The frame
 * hint (lib/organiser-frame-hint.ts) stands in only while the record loads.
 */

const loading: OrganiserLoad = { loading: true, organiser: null, error: null };
const record = (status: OrganiserStatus): OrganiserLoad => ({ loading: false, organiser: { status }, error: null });
const none: OrganiserLoad = { loading: false, organiser: null, error: null };
const failed: OrganiserLoad = { loading: false, organiser: null, error: "Couldn't load your organiser status." };

const href = (signedIn: boolean, load: OrganiserLoad, hinted = false) =>
  organisersHref(isKnownOrganiser({ signedIn, record: load, hinted }));

describe("For organisers' destination", () => {
  it("an approved organiser goes to /dashboard, hint or not", () => {
    expect(href(true, record("approved"))).toBe("/dashboard");
    expect(href(true, record("approved"), true)).toBe("/dashboard");
  });

  it("while the record loads, the hint decides: /dashboard with it, the For organisers page without", () => {
    expect(href(true, loading, true)).toBe("/dashboard");
    expect(href(true, loading, false)).toBe("/organisers/apply");
  });

  it("the record overrules a stale hint: pending, rejected or no application go to the For organisers page", () => {
    for (const status of ["pending", "rejected"] as const) expect(href(true, record(status), true)).toBe("/organisers/apply");
    expect(href(true, none, true)).toBe("/organisers/apply");
  });

  it("a record that failed to load isn't known: the For organisers page (it says what went wrong, with Try again)", () => {
    expect(href(true, failed, true)).toBe("/organisers/apply");
  });

  it("signed out, still signing in, or in the demo (accounts not configured: signedIn false): the For organisers page", () => {
    expect(href(false, record("approved"), true)).toBe("/organisers/apply");
    expect(href(false, loading, true)).toBe("/organisers/apply");
  });
});
