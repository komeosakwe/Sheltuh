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

export function createPostgresDb(databaseUrl: string): Db {
  const sql = postgres(databaseUrl, {
    // Supabase's transaction-mode pooler (port 6543), which serverless
    // hosting should use, doesn't support prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
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
