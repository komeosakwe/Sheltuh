// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Live /map asks only for upcoming events, 50 a page. Without these it got the
 * API's default: the 20 oldest published events, ended ones included.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listPublicEvents = vi.fn().mockResolvedValue({ items: [], nextCursor: undefined });
vi.mock("@/lib/api/public-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/public-events")>()),
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

const { default: SceneMap } = await import("@/components/SceneMap");

afterEach(cleanup);

describe("live /map loading", () => {
  it("asks for upcoming events only, 50 a page", async () => {
    render(<SceneMap />);
    await waitFor(() => expect(listPublicEvents).toHaveBeenCalled());
    expect(listPublicEvents).toHaveBeenCalledWith({ upcoming: true, limit: 50, cursor: undefined });
  });
});
