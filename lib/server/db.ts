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
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** What postgres.js resolved a URL (plus PGHOST, PGSSL, …) to: where it will connect, and its TLS setting. */
export interface ResolvedConnection {
  host: string[];
  path: string | false;
  ssl: unknown;
}

/** TLS settings that encrypt and can't be talked down to plain text by the network. */
export type DatabaseTls = "require" | { ca: string; rejectUnauthorized: true };

/**
 * TLS settings postgres.js may connect without: off (false, an empty value,
 * "disable"/"false" from PGSSL, which postgres.js only maps to off when they
 * come from the URL), "prefer" (falls back to plain text if the server, or
 * someone in the middle, declines TLS) and "allow".
 */
function isWeakTls(ssl: unknown): boolean {
  return !ssl || ssl === "disable" || ssl === "false" || ssl === "prefer" || ssl === "allow";
}

/**
 * The CA certificate from DATABASE_CA_CERT (PEM), if set: optional hardening
 * that turns TLS into full verification (the certificate must chain to this
 * CA and name the host), which stops an attacker in the middle as well as an
 * eavesdropper. A value pasted with literal "\n" sequences is accepted.
 * Throws, naming only the variable, when it's set but isn't a PEM certificate.
 */
export function databaseCaCert(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  const pem = raw.replace(/\\n/g, "\n");
  if (!pem.includes("-----BEGIN CERTIFICATE-----") || !pem.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_CA_CERT is set but isn't a PEM certificate (-----BEGIN CERTIFICATE----- …)");
  }
  return pem;
}

/**
 * The TLS setting to force on a connection, or undefined to leave
 * postgres.js's own setting alone. Decided from what postgres.js itself
 * parsed (`postgres(url).options`), so the URL is never read two different
 * ways: several hosts, a password holding "@" or "," and the PGHOST and
 * PGSSL fallbacks all count exactly as postgres.js will use them.
 *
 * - Every host on this machine (localhost, 127.0.0.1, ::1) or a unix socket:
 *   left alone. Local test clusters and the dev database don't do TLS.
 * - Any other host: TLS is always required, whatever the URL says. A setting
 *   that allows plain text (none, disable, false, an empty value, allow,
 *   prefer) is overridden to "require", so a pasted `sslmode=disable` can't
 *   send buyers' personal data and the database password in the clear. A
 *   stronger setting already in force (require, verify-full, from the URL or
 *   PGSSL) is kept.
 * - With a CA certificate (DATABASE_CA_CERT), any other host gets full
 *   verification against that CA instead, whatever else was set.
 *
 * "require" encrypts without checking the server's certificate (as libpq's
 * sslmode=require): it beats eavesdropping, not an active attacker in the
 * middle. The CA certificate closes that gap.
 */
export function forcedDatabaseTls(resolved: ResolvedConnection, caCert?: string): DatabaseTls | undefined {
  const local =
    Boolean(resolved.path) ||
    (resolved.host.length > 0 && resolved.host.every((host) => LOCAL_HOSTS.has(host.toLowerCase())));
  if (local) return undefined;
  if (caCert) return { ca: caCert, rejectUnauthorized: true };
  return isWeakTls(resolved.ssl) ? "require" : undefined;
}

type ConnectOptions = Omit<postgres.Options<Record<string, postgres.PostgresType>>, "ssl" | "host" | "path">;

/**
 * A postgres.js client with forcedDatabaseTls applied. Everything that
 * connects with DATABASE_URL goes through here (the app, the dev seed
 * script). Creating a postgres.js client doesn't connect (connections open
 * on the first query), so the first client is only used to read how
 * postgres.js resolved the URL, and is kept when nothing needs forcing.
 */
export function connectPostgres(
  databaseUrl: string,
  options: ConnectOptions,
  env: Record<string, string | undefined> = process.env,
): postgres.Sql {
  const sql = postgres(databaseUrl, options);
  const { host, path, ssl: parsedSsl } = sql.options;
  const ssl = forcedDatabaseTls({ host, path: path || false, ssl: parsedSsl }, databaseCaCert(env));
  return ssl === undefined ? sql : postgres(databaseUrl, { ...options, ssl });
}

export function createPostgresDb(databaseUrl: string): Db {
  const sql = connectPostgres(databaseUrl, {
    // Supabase's transaction-mode pooler (port 6543), which serverless
    // hosting should use, doesn't support prepared statements.
    prepare: false,
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
