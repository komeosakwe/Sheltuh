-- Minimal stand-ins for what a real Supabase project already provides, so the
-- migrations can be applied to a plain Postgres (tests use PGlite). Never run
-- this against a real Supabase database.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
