// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import MapStyles from "@/components/map/MapStyles";

/*
 * Photo focus on the map (docs/architecture.md, "Photo focus"). leaflet.css gives every `img` in the
 * marker pane `width: auto`, which beats a utility class such as `w-full`: a pin's 3:2 photo then
 * kept its own proportions instead of filling its box, and `object-position` had nothing to move.
 * jsdom can't compute that cascade, so this pins the two selectors' specificity; the real geometry
 * is checked in a browser by e2e/map-image-focus.spec.ts.
 */

/** (ids, classes/attributes, elements) of a compound selector without combinators or pseudo-classes. */
function specificity(selector: string): [number, number, number] {
  const parts = selector.trim().split(/\s+/);
  let classes = 0;
  let elements = 0;
  for (const part of parts) {
    classes += (part.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
    if (/^[a-z]/i.test(part)) elements += 1;
  }
  return [0, classes, elements];
}

const isHigher = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

describe("MapStyles: photos inside markers", () => {
  it("makes marker photos fill their box with a rule that outranks leaflet.css's `width: auto`", () => {
    const leaflet = readFileSync("node_modules/leaflet/dist/leaflet.css", "utf8");
    expect(leaflet).toMatch(/\.leaflet-container \.leaflet-marker-pane img,[\s\S]*?width: auto;/);
    const leafletSelector = ".leaflet-container .leaflet-marker-pane img";

    const { container } = render(<MapStyles />);
    const css = container.querySelector("style")?.textContent ?? "";
    const rule = css.match(/([^{}]+)\{\s*width: 100%;\s*\}/);
    expect(rule).not.toBeNull();
    const ours = (rule?.[1] ?? "").trim().replace(/\/\*[\s\S]*?\*\//g, "").trim();
    expect(ours).toBe(".leaflet-container .leaflet-marker-pane .scene-marker img");
    expect(isHigher(specificity(ours), specificity(leafletSelector))).toBe(true);
  });
});
