// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TicketsHashFocus from "@/components/TicketsHashFocus";

function Page() {
  return (
    <>
      <a href="#x">Before</a>
      <div id="tickets" tabIndex={-1}>
        Tickets
      </div>
      <TicketsHashFocus />
    </>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("TicketsHashFocus (arriving at /events/{slug}#tickets)", () => {
  it("moves focus to the ticket section when the page opens at #tickets", () => {
    window.history.replaceState(null, "", "/events/a#tickets");
    const { container } = render(<Page />);
    expect(document.activeElement).toBe(container.querySelector("#tickets"));
  });

  it("leaves focus alone without the hash", () => {
    window.history.replaceState(null, "", "/events/a");
    const { container } = render(<Page />);
    expect(document.activeElement).not.toBe(container.querySelector("#tickets"));
  });

  it("follows a later jump to #tickets on the same page", () => {
    window.history.replaceState(null, "", "/events/a");
    const { container } = render(<Page />);
    act(() => {
      window.history.replaceState(null, "", "/events/a#tickets");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(document.activeElement).toBe(container.querySelector("#tickets"));
  });
});
