-- event_images was created with row-level security on but, unlike every other
-- table in the init migration, without revoking Supabase's default grants.
-- RLS with no policies already blocks the Data API, but the rule in
-- docs/architecture.md is "no client grants at all", so one mistaken policy or
-- RLS toggle couldn't expose the table to the public key. Match the others.
revoke all on public.event_images from anon, authenticated;
