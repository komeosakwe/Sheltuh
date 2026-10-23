import { describe, expect, it } from "vitest";
import { buttonClass } from "@/components/ui/Button";

describe("buttonClass", () => {
  it("maps each size to its class", () => {
    expect(buttonClass("solid", "sm")).toBe("btn btn-solid btn-sm");
    expect(buttonClass("solid", "md")).toBe("btn btn-solid");
    expect(buttonClass("outline", "lg")).toBe("btn btn-outline btn-lg");
  });

  it("maps the Signal Orange conversion variant", () => {
    expect(buttonClass("signal")).toBe("btn btn-signal");
    expect(buttonClass("signal", "lg", "w-full")).toBe("btn btn-signal btn-lg w-full");
  });

  it("defaults to a medium solid button and appends extra classes", () => {
    expect(buttonClass()).toBe("btn btn-solid");
    expect(buttonClass(undefined, undefined, "mt-8 w-full")).toBe("btn btn-solid mt-8 w-full");
  });
});
