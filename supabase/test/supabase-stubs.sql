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
