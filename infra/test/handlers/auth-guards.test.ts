import { describe, expect, it } from "vitest";
import { getCallerGroups, getCallerSub, requireAdmin } from "../../lambda/shared/auth";
import { HttpError } from "../../lambda/shared/http";
import { adminClaims, fakeEvent, organiserClaims } from "../helpers/fake-event";

describe("unauthenticated requests", () => {
  it("getCallerSub rejects a request with no JWT claims at all", () => {
    const event = fakeEvent();
    expect(() => getCallerSub(event)).toThrow(HttpError);
    try {
      getCallerSub(event);
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(401);
    }
  });

  it("getCallerSub rejects claims with no sub", () => {
    const event = fakeEvent({ claims: { email: "no-sub@example.com" } });
    expect(() => getCallerSub(event)).toThrow(HttpError);
  });

  it("requireAdmin rejects an unauthenticated request with 401, not 403", () => {
    const event = fakeEvent();
    try {
      requireAdmin(event);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(401);
    }
  });
});

describe("non-admin approval attempts", () => {
  it("requireAdmin rejects a signed-in user who isn't in the admins group", () => {
    const event = fakeEvent({ claims: organiserClaims("user-1") });
    try {
      requireAdmin(event);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(403);
    }
  });

  it("requireAdmin rejects a user with unrelated group memberships", () => {
    const event = fakeEvent({ claims: { sub: "user-1", "cognito:groups": ["beta-testers"] } });
    expect(() => requireAdmin(event)).toThrow(HttpError);
  });

  it("requireAdmin succeeds only for a real admins-group member, returning their sub", () => {
    const event = fakeEvent({ claims: adminClaims("admin-1") });
    expect(requireAdmin(event)).toBe("admin-1");
  });

  it("getCallerGroups handles both array-shaped and single-string cognito:groups claims", () => {
    expect(getCallerGroups(fakeEvent({ claims: { sub: "u", "cognito:groups": ["admins", "x"] } }))).toEqual([
      "admins",
      "x",
    ]);
    // A single membership can arrive as a bare (non-JSON) string rather than an array.
    expect(getCallerGroups(fakeEvent({ claims: { sub: "u", "cognito:groups": "admins" } }))).toEqual(["admins"]);
    expect(getCallerGroups(fakeEvent({ claims: { sub: "u" } }))).toEqual([]);
  });
});
