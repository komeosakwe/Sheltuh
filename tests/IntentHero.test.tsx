// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import IntentHero from "@/components/IntentHero";

afterEach(cleanup);

describe("IntentHero intent pills", () => {
  it("are links that each go somewhere", () => {
    render(<IntentHero />);
    expect(screen.getByRole("link", { name: "I want to discover" })).toHaveAttribute("href", "#feed");
    expect(screen.getByRole("link", { name: "I want to connect" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "I want to make" })).toHaveAttribute("href", "/organisers/apply");
  });
});
