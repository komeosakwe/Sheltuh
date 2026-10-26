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
-- Set by Supabase Auth when an account is banned (until then) or soft-deleted
-- (read by lib/server/email-outbox.ts's adminReviewRecipients).
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
-- Read by the invite page's "Create account" (lib/server/handlers/invites.ts):
-- an unconfirmed account is deleted only if it has never signed in, and a
-- freshly minted invite account must have no password. Supabase Auth stores
-- "no password" as null or ''.
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.users add column if not exists encrypted_password text;
-- Set by Supabase Auth's generate_link (type invite) on the account it mints
-- for: with no password and no sign-in, that's what tells a fresh invite
-- account (reused by the next "Create account") from someone's registration.
alter table auth.users add column if not exists invited_at timestamptz;
-- Supabase Auth's sign-in identities: an email sign-up or invite has one with
-- provider 'email', and a Google or Apple sign-in adds one with its provider.
-- Only what "Create account" reads (an account with a non-email identity is
-- never treated as a fresh invite account). As in Supabase, deleting the
-- user deletes its identities.
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
);

-- Supabase Storage: just the bucket and object tables, with the columns the
-- migrations and the API's SQL use (event clips: 20261106000000_event_clips.sql
-- creates the private `event-clips` bucket). As in Supabase, RLS is on and
-- anon/authenticated are granted the tables (access then depends on
-- storage.objects policies, which the migrations never add).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.buckets, storage.objects to anon, authenticated;
