import { describe, expect, it } from "vitest";
import { isOrganiserCoverUrl } from "@/lib/api/organisers";

/** fetchOrganiserCover sends the caller's bearer token, so it only fetches the API's own cover URLs. */
describe("isOrganiserCoverUrl", () => {
  const id = "3f6c2b1e-8a4d-4c2f-9b7e-1d2a3b4c5d6e";

  it.each([`/api/organisers/${id}/cover`, `/api/organisers/${id}/cover?v=1761200000000`, `/api/organisers/${id}/cover?size=small&v=1`])(
    "accepts %s",
    (url) => expect(isOrganiserCoverUrl(url)).toBe(true),
  );

  it.each([
    `/api/organisers/../admin/organisers/${id}`,
    `/api/organisers/${id}/cover/../../admin/x`,
    `/api/organisers/me/cover`,
    `/api/organisers/${id}/logo`,
    `/api/organisers/${id}/profile`,
    `https://evil.example/api/organisers/${id}/cover`,
    `//evil.example/api/organisers/${id}/cover`,
  ])("refuses %s", (url) => expect(isOrganiserCoverUrl(url)).toBe(false));
});
