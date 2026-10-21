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
-- Supabase keeps app_metadata here; role 'admin' is what makes an admin
-- (scripts/promote-admin.ts). Read by private.ticket_check_ins_guard.
alter table auth.users add column if not exists raw_app_meta_data jsonb;

-- Supabase grants anon/authenticated access to every new table in `public` by
-- default; the migrations must revoke it (docs/architecture.md: "no client
-- grants"). Mirror that here so tests/server/schema-grants.test.ts can catch a
-- table that forgets to.
alter default privileges in schema public grant all on tables to anon, authenticated;
-- Sequences too (identity columns' sequences included).
alter default privileges in schema public grant all on sequences to anon, authenticated;
-- Set by Supabase Auth once the user confirms their email (read by
-- private.notify_followers).
alter table auth.users add column if not exists email_confirmed_at timestamptz;
