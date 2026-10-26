import postgres from "postgres";

/**
 * The only database surface handlers use: parameterised SQL in, plain rows
 * out. Production runs it over postgres.js against Supabase's Postgres
 * (DATABASE_URL); tests run the same SQL against an in-process PGlite
 * (tests/server/test-db.ts), so the queries and the migration's functions
 * are exercised for real rather than mocked.
 */
/**
 * JSON params are passed as JSON.stringify'd strings and cast in SQL with
 * `$n::text::jsonb`: the explicit text type stops either driver from
 * re-encoding the string as a JSON string literal.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Hosts reached without leaving the machine: no TLS needed (local test clusters, the dev database). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Whether a connection to `databaseUrl` must be forced onto TLS: the URL
 * says nothing about TLS itself (no `sslmode` or `ssl` parameter, no
 * `sslrootcert=system`), and some host isn't this machine (localhost,
 * 127.0.0.1, ::1, or a unix socket directory). postgres.js otherwise
 * connects in plain text when the URL doesn't ask for TLS, and the
 * connection carries buyers' personal data and the database password.
 *
 * An explicit `sslmode` in the URL always wins, `disable` included (a local
 * cluster reached by another name, say). A URL with no host at all falls
 * back to PGHOST or localhost in postgres.js, so it isn't forced.
 */
export function requiresForcedTls(databaseUrl: string): boolean {
  const schemeEnd = databaseUrl.indexOf("://");
  if (schemeEnd < 0) return false;
  const rest = databaseUrl.slice(schemeEnd + 3);
  // Read by hand, not with `new URL`: postgres.js accepts several hosts
  // (`host1:5432,host2:5432`), which URL can't parse.
  const queryStart = rest.indexOf("?");
  const query = new URLSearchParams(queryStart < 0 ? "" : rest.slice(queryStart + 1).split("#")[0]);
  if (query.has("sslmode") || query.has("ssl") || query.get("sslrootcert") === "system") return false;
  // The authority as written (`user:pass@host1:5432,host2`), percent-encoded
  // socket directories ("%2Ftmp") included.
  const authority = rest.split(/[/?#]/)[0];
  const hostList = authority.slice(authority.lastIndexOf("@") + 1);
  if (!hostList) return false;
  const hosts = hostList.split(",").map((entry) => {
    let host: string;
    try {
      host = decodeURIComponent(entry);
    } catch {
      host = entry;
    }
    // Drop the port: "[::1]:5432" → "[::1]", "db.example:6543" → "db.example".
    if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
    return host.includes("/") ? host : host.split(":")[0];
  });
  return hosts.some((host) => !(LOCAL_HOSTS.has(host.toLowerCase()) || host.startsWith("/")));
}

export function createPostgresDb(databaseUrl: string): Db {
  const sql = postgres(databaseUrl, {
    // Supabase's transaction-mode pooler (port 6543), which serverless
    // hosting should use, doesn't support prepared statements.
    prepare: false,
    // TLS for any database off this machine, even if the URL forgot
    // `sslmode=require` (requiresForcedTls). "require" encrypts without
    // checking the server's certificate, as libpq's sslmode=require; a URL
    // with its own sslmode (e.g. verify-full) keeps it.
    ...(requiresForcedTls(databaseUrl) ? { ssl: "require" as const } : {}),
    max: 5,
    idle_timeout: 20,
    // Fail fast (seconds) when the database can't be reached, e.g. a paused
    // project, instead of holding the request open for postgres.js's 30s default.
    connect_timeout: 10,
  });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
  };
}

/** SQLSTATE of a database error from either driver, if it is one. */
export function pgErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Constraint name of a database error (postgres.js and PGlite name the field differently). */
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint_name?: unknown; constraint?: unknown } | null;
  const name = e?.constraint_name ?? e?.constraint;
  return typeof name === "string" ? name : undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_CHECK_VIOLATION = "23514";
export const PG_UNDEFINED_FUNCTION = "42883";
