# Issue #10 status: event links and previews, map images, seating plans, national positioning

Each requirement of GitHub issue #10 ("Claude handover: event links &
previews, map images, seating plans, national positioning") checked against
the code on branch `claude/gifted-cannon-k40f9j` (after the link-preview
commit, Task A below). **Done** means the requirement is met in code, with
tests; **Partial** means some of it is; **Not done** means nothing for it
exists yet. Nothing here has been checked on a real phone, in Instagram, or
against a deployed site.

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Optional seating plan image or document, view-only vs assigned | Partial: assigned seating is built; a view-only plan upload is not |
| 2 | Event imagery on the map | Partial: images, fallback and lazy loading are done; there are no thumbnails |
| 3 | Australia-wide positioning, plus a social bio doc | Not done |
| 4 | Shareable organiser pitch page with real statistics or a labelled empty state | Partial: a page exists; no statistics and no empty state |
| 5 | Custom event slugs, redirects, copy link | Not done (a share/copy action exists on the event page only) |
| 6 | Link previews and in-app browser behaviour | Partial: per-page metadata is done for the key pages; Instagram is unverified |

## 1. Optional seating plans: Partial

- **Assigned seating: done.** Seat maps, holds and sales enforce
  assignments through checkout, inventory and check-in:
  `supabase/migrations/20261101000000_reserved_seating.sql`
  (`event_seat_maps`, `event_seats`, `tickets.seat_id`),
  `20261101000100_seat_holds.sql` (`private.hold_seats`, `fulfil_order`
  marks seats sold), `20261102000000_seating_hardening.sql`; the buyer's
  picker at `app/events/[slug]/seats/page.tsx` (`components/seating/SeatPicker.tsx`);
  the organiser's editor at `app/dashboard/[eventId]/seat-map/page.tsx` and the
  admin's at `app/admin/events/[eventId]/seat-map/page.tsx`; the seat shown at
  check-in (`lib/server/handlers/check-ins.ts`, `seat_section`/`seat_row`/`seat_label`).
  Plan: `docs/SEATING_PLAN.md`. Caveat from that doc: there's no on/off
  switch, and seated events shouldn't be approved for real on-sales until
  per-visitor hold protection is chosen.
- **View-only plan image or document: not done.** No table, route or UI
  stores a second image or a document per event. `public.event_images` holds
  exactly one image per event (the cover: `on conflict (event_id)` in
  `lib/server/handlers/event-images.ts`), JPEG, PNG or WebP only (no PDF).
  `grep -ri "seating.plan\|floor.plan"` over `lib`, `app`, `components` and
  `supabase` finds only the seat-map work.

## 2. Event imagery on the map: Partial

- **Done:** markers, cluster markers, the spot list and the selected-event card
  show the event's photo, with the generated poster art as the fallback when
  there's no photo or it fails to load: `components/map/MapEventMarker.tsx`,
  `components/map/MapClusterMarker.tsx`, `components/map/MapSpotList.tsx`,
  `components/map/SceneMapEventCard.tsx`, all through `components/EventArt.tsx`
  (`loading="lazy"` unless prioritised, `decoding="async"`, `onError` back to
  the poster). A marker is a real `<button>` with `aria-pressed` and a label
  (keyboard reachable). Filters are unchanged (`components/SceneMapFilterBar.tsx`).
  The photo and poster fallback are tested in `tests/SceneMap.test.tsx`.
- **Not done:** thumbnail sizes. Every marker loads the full stored image
  (`GET /api/events/{id}/image`, up to 1600 px on the long edge and 2 MB,
  `lib/image.ts`), however small the marker. No resized variant exists. With
  many events on the map, this is the main performance risk.

## 3. Australia-wide positioning: Not done

User-facing copy and metadata still say Melbourne only, for example:
`app/layout.tsx` (title "Sheltüh — Melbourne creative events" and the
description), `app/manifest.ts`, `components/home/HomeHero.tsx` ("Melbourne •
What's on", "Discover Melbourne's music…"), `components/home/home-content.ts`,
`components/Footer.tsx`, `components/Nav.tsx` ("Melbourne · Australia"),
`app/about/page.tsx`, `app/partners/page.tsx`, `app/organisers/submit/page.tsx`
("Melbourne-first"), `app/events/page.tsx` and `components/SceneMap.tsx`
(eyebrows), `components/SceneMapFilterBar.tsx` ("All of Melbourne").

Beyond copy, the product itself assumes Melbourne: every date is formatted
and entered in `Australia/Melbourne` time (`lib/format.ts`,
`lib/server/melbourne-time.ts`, "Starts (Melbourne time)" in
`components/dashboard/EventEditor.tsx`), and map positions fall back to
Melbourne suburb centroids (`lib/geo.ts`). An event in Perth or Brisbane
would show the wrong local time. Copy can change first, but "Australia-wide"
shouldn't be claimed for organisers outside Victoria's time zone until
events carry their own time zone.

No social bio document exists in `docs/`.

## 4. Organiser pitch page: Partial

- **Exists:** `app/partners/page.tsx` ("Become a partner"): benefits, the
  fee (4% + A$0.50, matching `lib/fees.ts`), how review works, and a link to
  `app/organisers/apply/page.tsx` (the application form). Since Task A it has
  its own canonical URL and Open Graph/Twitter metadata, so it previews
  properly when shared.
- **Not done:** no statistics of any kind, and no labelled "figures not yet
  available" state. No public aggregate endpoint exists (only organisers'
  own analytics, `lib/server/handlers/analytics.ts`, and admin views). The
  copy is Melbourne-only (requirement 3).

## 5. Custom event slugs: Not done

- Slugs are set once, at creation, from the title: `withUniqueSlug` in
  `lib/server/handlers/events.ts` (also used by
  `lib/server/handlers/admin-authoring.ts`), `slugify` in
  `lib/server/validation.ts`, with a random suffix on collision against the
  unique `events_slug_key`. The format is enforced by the database
  (`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`, `20260925000000_init.sql`).
- **No edit path:** neither the organiser's nor the admin's edit API accepts
  a slug, and no migration ever updates `events.slug`.
- **No redirect table:** nothing stores old slugs and nothing redirects
  (no `redirect()` or `permanentRedirect()` in `app/events`).
- **Reserved paths:** not needed today. Slugs only live under `/events/`,
  whose only other children (`seats`, `calendar.ics`) are nested below
  `[slug]`, so they can't collide.
- **Copy link:** the public event page has a share button (native share
  sheet, or copy) for the event's address on the current origin, without
  `?ref=` (`components/ShareButton.tsx`, `publicEventUrl`, used in
  `components/EventDetailsView.tsx`). The organiser dashboard has copy actions only for tracking links
  (`components/analytics/TrackingLinks.tsx`), not for the plain event link.

What it needs (next PR, not implemented): a `private.event_slug_history`
table (old slug unique, event id), a `private.change_event_slug` function
that locks the event, checks ownership and status, validates against the
same pattern plus a length cap and a reserved list, writes the old slug to
history and the new one to `events` in one transaction (the unique
constraint settles races; a slug in history for another event is refused),
then a lookup on 404 in the slug routes (page, `GET /api/events/slug/{slug}`,
`.ics`, the metadata read) that permanently redirects to the current slug.
Loops can't happen if history maps to an event id and the redirect always
targets that event's current slug. Plus the organiser and admin UI, a
dashboard copy-link button, and tests for collisions, permissions and
redirects.

## 6. Link previews and in-app browsers: Partial

- **Done (Task A):** server-side `generateMetadata` with title, description,
  canonical, Open Graph (`en_AU`) and a `summary_large_image` Twitter card for:
  - `/events/[slug]`: a published event's title, date, venue and excerpt, and
    its reviewed cover image as an absolute URL
    (`/api/events/{id}/image?v=…`, public for published events), or the
    site's share image. Unpublished or unknown events: noindex "Event not
    found".
  - `/organisers/[organiserId]`: an approved organiser's name and bio.
  - `/` and `/partners`.

  Code: `lib/share-metadata.ts`, `lib/server/share-metadata.ts`; tests:
  `tests/share-metadata.test.ts`, `tests/server/share-metadata.test.ts`.
  The page bodies still load client-side in live mode. Next sends the
  metadata in `<head>` to HTML-limited crawlers (its list includes
  `facebookexternalhit`, `Twitterbot`, `WhatsApp`, `Slackbot`,
  `LinkedInBot`, `Discordbot`, `applebot`) and streams it to others.
- **Not done:** other public pages (`/events`, `/map`, `/about`, `/help`,
  `/search`) have a title but inherit the site share image and no
  `og:title`, description or canonical of their own. There's no
  `robots.txt` or sitemap. Cover images have no stored width or height, so
  `og:image:width`/`height` aren't sent, and WebP covers may not preview
  on every platform.
- **In-app browsers:** the install prompt already stays away from Instagram,
  Facebook, TikTok and other in-app browsers (`lib/pwa/install.ts`,
  `NOT_SAFARI`). No other in-app-specific behaviour exists or is needed so
  far. Instagram controls its own in-app browser; we can't force its UI.
- **Needs manual checking on real devices** (not possible from this repo):
  1. Paste an event link into the Facebook Sharing Debugger and the X card
     validator, and send it in an Instagram DM, WhatsApp and iMessage:
     check the title, description and image, then rescrape after an edit.
  2. Open the link from an Instagram bio and story on iOS and Android:
     the page loads (it's rendered client-side, so check the loading state),
     "Get tickets" and Stripe Checkout work inside the in-app browser, and
     the "Add to calendar" and share buttons behave.
  3. A WebP cover's preview on each platform.
  4. Telegram isn't on Next's HTML-limited list, so it gets streamed
     metadata: check whether it picks it up.

## Unfinished requirements

1. Custom event slugs: edit path for organisers and admins, validation,
   reserved list, history table and permanent redirects, dashboard
   copy-link button, tests (requirement 5).
2. View-only seating plan image or PDF upload and display, separate from
   the cover image and from assigned seating (requirement 1).
3. Map thumbnails: a resized image variant for markers and cards
   (requirement 2).
4. Australia-wide copy and metadata, the social bio doc, and per-event time
   zones before claiming events outside Melbourne's time zone (requirement 3).
5. Pitch page statistics: an approved, aggregated, public figure set with
   definitions, or a clearly labelled "not yet available" state
   (requirement 4).
6. Link previews for the remaining public pages, `robots.txt` and a
   sitemap, image dimensions, and the manual checks above (requirement 6).

## Suggested PR split

1. **Custom slugs and redirects** (migration, API, organiser and admin UI,
   copy link, tests including races on real Postgres). This builds on Task
   A's metadata, which reads by slug and needs the same redirect rule.
2. **Remaining link previews**: other public pages, `robots.txt`, sitemap,
   then the manual Instagram, WhatsApp and iMessage pass. Small.
3. **Map thumbnails**: a resized variant generated at upload (`sharp` is
   already a dependency), served next to the original. No schema change if
   stored in `event_images`; otherwise one additive migration.
4. **Seating plan upload** (view-only): a new table or a kind column,
   upload, preview and removal in the editor, and display on the event page
   with zoom and alt text, clearly separate from assigned seating.
5. **Australia-wide copy and bio doc**, after the owner decides whether
   per-event time zones come first. This touches the UI that's being
   redesigned in parallel, so it's best done after that work merges.
6. **Pitch page statistics**, once the owner approves which figures to
   publish, with their definitions.
