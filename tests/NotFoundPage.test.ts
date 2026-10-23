import { describe, expect, it } from "vitest";
import { metadata } from "@/app/not-found";

describe("the 404 page", () => {
  it("has its own title, so the tab and screen readers say what happened (WCAG 2.4.2)", () => {
    expect(metadata.title).toBe("Page not found — Sheltüh");
  });
});
