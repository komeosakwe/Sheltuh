import { beforeEach, describe, expect, it, vi } from "vitest";

const postgresCalls = vi.hoisted(() => [] as { url: string; options: Record<string, unknown> }[]);
vi.mock("postgres", () => ({
  default: (url: string, options: Record<string, unknown>) => {
    postgresCalls.push({ url, options });
    return { unsafe: async () => [] };
  },
}));

import { createPostgresDb, requiresForcedTls } from "@/lib/server/db";

describe("requiresForcedTls", () => {
  it("forces TLS for a database off this machine when the URL doesn't ask for it", () => {
    for (const url of [
      "postgresql://postgres.abcdefgh:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgres://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
      "postgres://user@10.0.0.5/db",
      "postgres://user@[2001:db8::1]:5432/db",
      "postgres://user@db.example",
      "postgres://user@db.example?application_name=sheltuh",
      // Several hosts: any one of them off the machine.
      "postgres://user@localhost:5432,db.example:5432/db",
      // A password holding an @: the host is after the last one.
      "postgres://user:p%40ss@word@db.example/db",
    ]) {
      expect([url, requiresForcedTls(url)]).toEqual([url, true]);
    }
  });

  it("leaves local clusters and unix sockets alone (test databases, development)", () => {
    for (const url of [
      "postgres://postgres@localhost:5432/postgres",
      "postgres://postgres@LOCALHOST/postgres",
      "postgres://sheltuh_test:pw@127.0.0.1:55432/sheltuh_test_db",
      "postgres://user@[::1]:5432/db",
      "postgres://user@[::1]/db",
      "postgres://user@localhost:5432,127.0.0.1:5433/db",
      "postgres://user@%2Fvar%2Frun%2Fpostgresql/db",
      "postgres://user@%2Ftmp:5432/db",
      // No host: postgres.js falls back to PGHOST or localhost.
      "postgres:///db",
      "postgres://user@/db",
    ]) {
      expect([url, requiresForcedTls(url)]).toEqual([url, false]);
    }
  });

  it("never overrides what the URL says about TLS, disable included", () => {
    for (const url of [
      "postgres://user@db.example/db?sslmode=require",
      "postgres://user@db.example/db?sslmode=verify-full",
      "postgres://user@db.example/db?sslmode=disable",
      "postgres://user@db.example/db?ssl=true",
      "postgres://user@db.example/db?application_name=x&sslrootcert=system",
    ]) {
      expect([url, requiresForcedTls(url)]).toEqual([url, false]);
    }
  });

  it("isn't fooled by a host-like string in the path, query or fragment", () => {
    expect(requiresForcedTls("postgres://user@localhost/db.example.com")).toBe(false);
    expect(requiresForcedTls("postgres://user@localhost/db?application_name=db.example.com")).toBe(false);
    expect(requiresForcedTls("postgres://user@localhost/db#db.example.com")).toBe(false);
    expect(requiresForcedTls("postgres://user@db.example/db#sslmode=disable")).toBe(true);
  });

  it("is false for something that isn't a URL (postgres.js decides what to do with it)", () => {
    expect(requiresForcedTls("")).toBe(false);
    expect(requiresForcedTls("not a url")).toBe(false);
  });
});

describe("createPostgresDb", () => {
  beforeEach(() => {
    postgresCalls.length = 0;
  });

  it("asks postgres.js for TLS (sslmode=require) only when the decision says so", () => {
    createPostgresDb("postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres");
    createPostgresDb("postgres://postgres@127.0.0.1:55432/db");
    createPostgresDb("postgres://postgres@db.example/db?sslmode=verify-full");
    expect(postgresCalls.map((call) => call.options.ssl)).toEqual(["require", undefined, undefined]);
    expect(postgresCalls.map((call) => "ssl" in call.options)).toEqual([true, false, false]);
    // The transaction-pooler settings are unchanged.
    for (const call of postgresCalls) expect(call.options).toMatchObject({ prepare: false, max: 5 });
  });
});
