-- Minimal stand-ins for what a real Supabase project already provides, so the
-- migrations can be applied to a plain Postgres (tests use PGlite). Never run
-- this against a real Supabase database.
-- Roles are cluster-wide, and test files set up their databases in
-- parallel, so tolerate another file creating them first.
do $$
begin
  create role anon nologin;
exception when duplicate_object or unique_violation then null;
end
$$;
do $$
begin
  create role authenticated nologin;
exception when duplicate_object or unique_violation then null;
end
$$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

-- Supabase grants anon/authenticated access to every new table in `public` by
-- default; the migrations must revoke it (docs/architecture.md: "no client
-- grants"). Mirror that here so tests/server/schema-grants.test.ts can catch a
-- table that forgets to.
alter default privileges in schema public grant all on tables to anon, authenticated;
-- Sequences too (identity columns' sequences included).
alter default privileges in schema public grant all on sequences to anon, authenticated;
