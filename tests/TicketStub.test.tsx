// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TicketStub from "@/components/tickets/TicketStub";

afterEach(cleanup);

describe("TicketStub", () => {
  it("prints the ticket type and code as text, and draws both barcodes as hidden decoration", () => {
    const { container } = render(
      <ul>
        <TicketStub code="K7M2-QW3R" typeName="General admission" />
      </ul>,
    );
    expect(screen.getByText("K7M2-QW3R")).toBeInTheDocument();
    expect(screen.getByText("General admission")).toBeInTheDocument();
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });

  it("gives different tickets different U-shaped barcodes", () => {
    const shape = (code: string) => {
      const { container, unmount } = render(
        <ul>
          <TicketStub code={code} typeName="GA" />
        </ul>,
      );
      const polys = Array.from(container.querySelectorAll("polygon")).map((p) => p.getAttribute("points"));
      unmount();
      return polys.join("|");
    };
    expect(shape("K7M2-QW3R")).not.toEqual(shape("A2B3-C4D5"));
  });
});
