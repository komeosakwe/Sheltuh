import { beforeEach, describe, expect, it, vi } from "vitest";

// The real postgres.js, with every client it creates recorded. Creating a
// client doesn't connect (connections open on the first query), so nothing
// here touches the network.
const postgresCalls = vi.hoisted(() => [] as { url: string; options: Record<string, unknown> }[]);
vi.mock("postgres", async (importOriginal) => {
  const real = (await importOriginal()) as { default: (url: string, options: Record<string, unknown>) => unknown };
  return {
    default: (url: string, options: Record<string, unknown>) => {
      postgresCalls.push({ url, options });
      return real.default(url, options);
    },
  };
});

import { connectPostgres, createPostgresDb, databaseCaCert, forcedDatabaseTls } from "@/lib/server/db";

const CA = "-----BEGIN CERTIFICATE-----\nMIIBplaceholder\n-----END CERTIFICATE-----";
const NO_ENV: Record<string, string | undefined> = {};

/** The TLS setting postgres.js ends up with for `url`, given `env` for DATABASE_CA_CERT. */
function effectiveSsl(url: string, env = NO_ENV): unknown {
  return connectPostgres(url, { prepare: false, max: 1 }, env).options.ssl;
}

describe("database TLS (connectPostgres)", () => {
  const original = { PGHOST: process.env.PGHOST, PGSSL: process.env.PGSSL };
  beforeEach(() => {
    postgresCalls.length = 0;
    delete process.env.PGHOST;
    delete process.env.PGSSL;
    return () => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    };
  });

  it("requires TLS for a database off this machine when the URL doesn't ask for it", () => {
    for (const url of [
      "postgresql://postgres.abcdefgh:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgres://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
      "postgres://user@10.0.0.5/db",
      "postgres://user@db.example",
      "postgres://user@db.example?application_name=sheltuh",
      // Several hosts: any one of them off the machine.
      "postgres://user@localhost:5432,db.example:5432/db",
      // Anything postgres.js doesn't resolve to a local host counts as remote,
      // e.g. an IPv6 literal, which postgres.js 3.4 reads as the host "[".
      "postgres://user@[2001:db8::1]:5432/db",
      "postgres://user@[::1]:5432/db",
    ]) {
      expect([url, effectiveSsl(url)]).toEqual([url, "require"]);
    }
  });

  it("overrides a URL setting that allows plain text on a remote host", () => {
    for (const url of [
      "postgres://user@db.example/db?sslmode=disable",
      "postgres://user@db.example/db?sslmode=",
      "postgres://user@db.example/db?ssl=",
      "postgres://user@db.example/db?ssl=false",
      "postgres://user@db.example/db?sslmode=allow",
      "postgres://user@db.example/db?sslmode=prefer",
      // A fragment isn't a query: postgres.js ignores it, so does the decision.
      "postgres://user@db.example/db#sslmode=verify-full",
    ]) {
      expect([url, effectiveSsl(url)]).toEqual([url, "require"]);
    }
  });

  it("keeps a stronger setting the URL already asks for", () => {
    expect(effectiveSsl("postgres://user@db.example/db?sslmode=require")).toBe("require");
    expect(effectiveSsl("postgres://user@db.example/db?sslmode=verify-full")).toBe("verify-full");
    expect(effectiveSsl("postgres://user@db.example/db?application_name=x&sslrootcert=system")).toBe("verify-full");
    // Kept, not replaced: one client per URL.
    expect(postgresCalls).toHaveLength(3);
  });

  it("reads the host the way postgres.js does (a password holding @ and ,)", () => {
    // postgres.js splits the authority at the first @: its hosts are
    // "R" and "y@localhost", and it tries R first.
    expect(effectiveSsl("postgres://u:x@R,y@localhost/db")).toBe("require");
  });

  it("uses PGHOST when the URL has no host, and keeps a stronger PGSSL", () => {
    process.env.PGHOST = "db.example";
    expect(effectiveSsl("postgres:///db")).toBe("require");
    process.env.PGSSL = "verify-full";
    expect(effectiveSsl("postgres:///db")).toBe("verify-full");
    process.env.PGSSL = "prefer";
    expect(effectiveSsl("postgres:///db")).toBe("require");
    process.env.PGSSL = "disable";
    expect(effectiveSsl("postgres:///db")).toBe("require");
    // A unix socket from PGHOST: local, left as postgres.js parsed it.
    process.env.PGHOST = "/var/run/postgresql";
    expect(effectiveSsl("postgres:///db")).toBe("disable");
  });

  it("leaves local clusters and unix sockets alone (test databases, development)", () => {
    for (const url of [
      "postgres://postgres@localhost:5432/postgres",
      "postgres://postgres@LOCALHOST/postgres",
      "postgres://sheltuh_test:pw@127.0.0.1:55432/sheltuh_test_db",
      "postgres://user@localhost:5432,127.0.0.1:5433/db",
      "postgres://user@localhost/db?sslmode=disable",
      // No host: postgres.js falls back to PGHOST (unset here) or localhost.
      "postgres:///db",
      "",
    ]) {
      expect([url, effectiveSsl(url)]).toEqual([url, false]);
    }
    expect(effectiveSsl("postgres://user@localhost/db?sslmode=require")).toBe("require");
  });

  it("isn't fooled by a host-like string in the path or query", () => {
    expect(effectiveSsl("postgres://user@localhost/db.example.com")).toBe(false);
    expect(effectiveSsl("postgres://user@localhost/db?application_name=db.example.com")).toBe(false);
  });

  it("verifies the server against DATABASE_CA_CERT when it's set, for remote hosts only", () => {
    const env = { DATABASE_CA_CERT: CA };
    for (const url of [
      "postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
      "postgres://user@db.example/db?sslmode=require",
      "postgres://user@db.example/db?sslmode=disable",
    ]) {
      expect([url, effectiveSsl(url, env)]).toEqual([url, { ca: CA, rejectUnauthorized: true }]);
    }
    expect(effectiveSsl("postgres://user@127.0.0.1:55432/db", env)).toBe(false);
  });
});

describe("databaseCaCert", () => {
  it("is undefined when unset or blank", () => {
    expect(databaseCaCert({})).toBeUndefined();
    expect(databaseCaCert({ DATABASE_CA_CERT: "  " })).toBeUndefined();
  });

  it("accepts a PEM pasted with literal \\n sequences", () => {
    expect(databaseCaCert({ DATABASE_CA_CERT: CA.replace(/\n/g, "\\n") })).toBe(CA);
    expect(databaseCaCert({ DATABASE_CA_CERT: `\n${CA}\n` })).toBe(CA);
  });

  it("refuses a value that isn't a PEM certificate, naming the variable but never the value", () => {
    const value = "not-a-certificate-value";
    let message = "";
    try {
      databaseCaCert({ DATABASE_CA_CERT: value });
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain("DATABASE_CA_CERT");
    expect(message).not.toContain(value);
  });
});

describe("forcedDatabaseTls", () => {
  it("treats a unix socket as local", () => {
    expect(forcedDatabaseTls({ host: ["db.example"], path: "/tmp/.s.PGSQL.5432", ssl: false })).toBeUndefined();
  });

  it("treats an empty host list as remote (fails safe)", () => {
    expect(forcedDatabaseTls({ host: [], path: false, ssl: false })).toBe("require");
  });
});

describe("createPostgresDb", () => {
  beforeEach(() => {
    postgresCalls.length = 0;
  });

  it("goes through the TLS decision and keeps the transaction-pooler settings", () => {
    createPostgresDb("postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres");
    createPostgresDb("postgres://postgres@127.0.0.1:55432/db");
    // The remote URL: a first client to read postgres.js's parse, then the
    // real one with TLS required. The local one: a single client, untouched.
    expect(postgresCalls.map((call) => call.options.ssl)).toEqual([undefined, "require", undefined]);
    for (const call of postgresCalls) expect(call.options).toMatchObject({ prepare: false, max: 5 });
  });
});
