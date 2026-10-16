-- Public organiser profile: "who posted this event", with their social links.
--
-- Social profiles are stored as handles, never as free-form URLs: the server
-- builds the https URLs itself (lib/server/organiser-input.ts), so a stored
-- value can't point anywhere but the network it names. The CHECKs mirror the
-- API's validation (which also strips a leading '@'), so a bad handle can't
-- get in by any other path. Every new column is nullable: unset means the
-- organiser hasn't given one.
--
-- website_url gains a CHECK that it's an http(s) URL of at most 2048
-- characters. The API has only ever accepted http(s) URLs (optionalUrl in
-- lib/server/validation.ts), so existing rows pass; if one didn't, this
-- migration would fail (and change nothing) rather than alter data.
--
-- No new table, policy or grant: public.organisers keeps RLS on with no
-- policies, and anon/authenticated still have no grants (init migration).
-- New columns get no column grants either.
--
-- Indexes: none added. The public profile reads one organiser by primary key,
-- then its published events by organiser_id; events_organiser_created_idx
-- (organiser_id, created_at desc) already narrows that to one organiser's
-- events (a handful each), which are then filtered and sorted in memory.
--
-- Reversible, not destructive: drop the four columns (discards any handles
-- entered since) and the website_url constraint.

alter table public.organisers
  add column instagram_handle text
    constraint organisers_instagram_handle_check
    check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$' and instagram_handle ~ '[A-Za-z0-9]'),
  add column tiktok_handle text
    constraint organisers_tiktok_handle_check
    check (tiktok_handle ~ '^[A-Za-z0-9._]{1,30}$' and tiktok_handle ~ '[A-Za-z0-9]'),
  add column facebook_page text
    constraint organisers_facebook_page_check
    check (facebook_page ~ '^[A-Za-z0-9.]{5,50}$' and facebook_page ~ '[A-Za-z0-9]'),
  add column x_handle text
    constraint organisers_x_handle_check
    check (x_handle ~ '^[A-Za-z0-9_]{1,15}$' and x_handle ~ '[A-Za-z0-9]'),
  add constraint organisers_website_url_check
    check (website_url ~* '^https?://' and char_length(website_url) <= 2048);
