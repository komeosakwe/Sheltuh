import { describe, expect, it } from "vitest";
import { isOrganiserLogoUrl } from "@/lib/api/organisers";

/** fetchOrganiserLogo sends the caller's bearer token, so it only fetches the API's own logo URLs. */
describe("isOrganiserLogoUrl", () => {
  const id = "3f6c2b1e-8a4d-4c2f-9b7e-1d2a3b4c5d6e";

  it.each([`/api/organisers/${id}/logo`, `/api/organisers/${id}/logo?v=1761200000000`, `/api/organisers/${id}/logo?size=thumb&v=1`])(
    "accepts %s",
    (url) => expect(isOrganiserLogoUrl(url)).toBe(true),
  );

  it.each([
    `/api/organisers/../admin/organisers/${id}`,
    `/api/organisers/${id}/logo/../../admin/x`,
    `/api/organisers/me/logo`,
    `/api/organisers/${id}/profile`,
    `https://evil.example/api/organisers/${id}/logo`,
    `//evil.example/api/organisers/${id}/logo`,
  ])("refuses %s", (url) => expect(isOrganiserLogoUrl(url)).toBe(false));
});
