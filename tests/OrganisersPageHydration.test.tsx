// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrganiserApplyPage from "@/app/organisers/apply/page";
import Footer from "@/components/Footer";
import { NavAccountProvider } from "@/components/nav/useNavAccount";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * The frame hint (lib/organiser-frame-hint.ts) on a server-rendered /organisers/apply: the server
 * never knows it, so its HTML is the page for everyone (search engines, first paint); hydrating
 * with the hint in this browser matches that HTML (no mismatch), then "Opening your dashboard…"
 * stands in and the footer's For organisers goes to the dashboard. Signed in from the first render
 * (the worst case: the hint is read the moment it can be).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/organisers/apply",
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: true, organiser: null, error: null, refreshing: false, refetch: vi.fn(), authStatus: "signed-in" }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("/organisers/apply hydrating with the hint", () => {
  it("serves the page, hydrates without a mismatch, then shows Opening your dashboard…", async () => {
    const tree = (
      <FakeAuthProvider value={fakeAuthValue({ userId: "u1" })}>
        <NavAccountProvider>
          <OrganiserApplyPage />
          <Footer />
        </NavAccountProvider>
      </FakeAuthProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain('aria-labelledby="organisers-title"');
    expect(html).toContain('href="/organisers/apply"');
    expect(html).not.toContain("Opening your dashboard");

    localStorage.setItem("sheltuh:organiser-frame", "u1");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => recoverable.push(error) });
    });
    const errors = consoleError.mock.calls;
    consoleError.mockRestore();
    expect(recoverable).toEqual([]);
    expect(errors).toEqual([]);

    expect(container.querySelector("[role='progressbar']")).toHaveAccessibleName("Opening your dashboard");
    expect(container.querySelector("[hidden] h1")).toHaveTextContent("Your event. Your community.");
    const footerLink = Array.from(container.querySelectorAll("footer a")).find((a) => a.textContent === "For organisers");
    expect(footerLink).toHaveAttribute("href", "/dashboard");
  });
});
