# Customer account area: as built (1120)

Source: Latte's 1120 Figma frames (page "1120 finial-email refine and customer dashboard" for tablet and
mobile, and the older "Dashboard" page for desktop Saved / Messages / Settings). Owner rule (21 Nov 2026):
the frames win over the written handoff. Tokens and type are the existing ones (`docs/design-system.md`);
the one addition is `heading-page` (Heading/H1 40/48 at every width).

## Shell (`app/(account)/layout.tsx`, `components/account/AccountShell.tsx`)

A route group, so `/profile`, `/tickets` (and `/tickets/accept`, `/tickets/received/[id]`), `/account`,
`/saved`, `/messages`, `/messages/[id]` and `/messages/blocked` keep their URLs.

| | Phones (< 768) | Tablet (768–1023) | Desktop (≥ 1024) |
| --- | --- | --- | --- |
| Page around the panel | none: the white panel is full-bleed, no radius | surface/muted, 24 top and sides, 32 below; panel radius 16 | surface/muted, 32 above, 64 below, 32 (64 from 1280) at the sides; panel radius 16, ≥ 960 tall, ≤ 1312 wide |
| Way between pages | Account tabs row, 16 in | Account tabs row, 24 in | 264px black sidebar |
| Page padding | 24 above and below, 16 sides | 24 | 56 top, 40 right and bottom, 48 left |

The five places, in order: Profile · My tickets · Saved · Messages · Settings (`useAccountNav`). Counts:
saved (FavouritesProvider), unread (UnreadProvider, the orange pill), upcoming tickets (`GET /api/me`
`upcomingCount`). Profile goes to the member page when other members can open it (visible, not
suspended), else `/profile`; it's the current place on `/profile` either way (`aria-current="page"` when
the link goes there, `"location"` when it goes to the member page). My tickets goes to its list,
`/tickets` (`MY_TICKETS_HREF`): `aria-current="page"` there, `"location"` on the pages under it (an Accept
page, a received ticket), in the tabs, the sidebar, the avatar menu and the drawer alike. The pill's count
(`upcomingCount`: distinct published events not started) and the list's "Upcoming · N" (cards whose event
hasn't ended) count different things, on purpose.

- **Account tabs** (`AccountTabs`): a nav of links with `aria-current="page"` (not ARIA tabs). Body/S
  Strong; current text/primary with a 2px foreground underline, others text/secondary; count pill
  surface/muted with Mono/S (Plex Mono), unread pill orange with a black number. 44px tall, 24 apart, 1px
  border/subtle under the row. Scrolls sideways on a phone (the frame clips; the handoff says scroll).
- **Sidebar** (`AccountSidebar`): an ink surface; 112px photo (cream circle without one), name
  (Label/Button), "@handle · N upcoming" (Plex Mono 12/16, text/secondary), the items (8px dot, Label/Button,
  48 tall, radius 16; current: surface/muted fill, orange label and dot), "→ Log out" in orange at the foot.
  The frames' raw `#8a8a8a` / `#2b2b2b` / `#1f1f1f` are the ink scope's muted / surface-border / surface.

Each page starts with `AccountPageHead` (title + one line). Empty states, until Latte designs them: one
line and a link to Discover.

## Pages

- **Saved** (`SavedPageContent`, `SavedEventCard`): filters All · This week (next 7 days) · Free with
  counts (aria-pressed); its own grid (`SAVED_GRID`: 1 / 2 from 768 / 3 from 1280); six cards, then
  "Show 6 more". The first page (48) shows at once and the rest of the list (up to 500) loads behind
  it, so the filters count all of it: This week and Free show their numbers, and their "none" lines,
  only once it's all in; a failed page says so with Try again. The card: 144px photo with the heart, category tag (32px),
  Heading/H3 title, "Suburb · Venue" in Plex Mono, going + price. Ended events keep their Remove list.
- **Messages** (`MessagesFrame` in `app/(account)/messages/layout.tsx`): the cream conversation list
  (280 from 768, 360 from 1280; above the thread on phones) beside the thread panel (676 / 764 tall, the
  messages scroll between head and composer). Rows: tinted 44px avatar, name (truncates), short time
  ("2h"), one-line preview, orange unread dot; the open one is white with `aria-current`. Bubbles carry
  their time (Plex Mono) inside, max 392. The 768 frame's stacked head, zero-height avatar, stacked
  composer and 50/50 name/time split are treated as slips (figma NOTES 30). The list stays mounted
  between conversations and reloads (InboxSync) after a read, reply, accept, decline, block or unblock,
  and when you open another conversation or go back to /messages.
- **Profile** (`app/(account)/profile/page.tsx`, `ProfilePageContent`): "Profile", "How you show on Who's
  Going lists.", then Settings' Your profile card (`ProfileCard`: loading, couldn't load + Try again, create,
  edit, suspended), head and card in one column (max 672). "See your public profile" (outline) at the
  head's right, over the card's edge, once other members can open it; the card's own "See your profile as
  members see it" is left out here (`showMemberPageLink={false}`), so there's one. A sign-in back to
  `#member-profile` focuses the card once it loads. Signed out: sign in, back to `/profile`. Demo: the
  disabled sample card. No frame for it yet: Latte to design; Delete your profile stays on Settings.
  The avatar menu's Profile row and the drawer's identity are `aria-current="location"` on `/profile`
  when they link to the member page, as the tabs are.
- **My tickets** (`app/(account)/tickets/(list)/page.tsx`, `components/tickets/MyTicketsList.tsx`, words in
  `lib/my-tickets.ts`): "My tickets", "Tickets you've bought or been sent.", then "Upcoming · N" and "Past ·
  N" (h2, 48 apart) over `SAVED_GRID` of compact `TicketCard`s, in the API's order (`GET /api/me/tickets`).
  One card per order (by the verified email) or received ticket. Upcoming cards have "Show ticket →"; past
  ones "View order" / "View ticket" in their bar; each action's name adds the event for screen readers. The
  bar and button sit in the card's foot (`mt-auto`), so buttons line up along a row; under 16rem of card (a
  phone at large text) the image goes above the words, and the date wraps.
  Order cards have counts only, so generic words: "Waiting to be accepted" ("1 sent, waiting for them to
  accept" for several), "· 2 sent" on the holder row, "✓ Checked in" ("✓ 1 of 2 checked in"), "2 sent. These
  QR codes no longer work.", "Refunded A$25.94" (the all-inclusive total), "Tickets not reserved. A$25.94
  refund on its way."; received cards "From Alex" and "This ticket is no longer valid" when void. An unlisted
  event: "No longer listed" in place of the date, no venue or image. Never a ticket code.
  "Show N more" (the next cursor page, deduped by id) sits under the list the last loaded card is in (not
  decided by the counts, which can drift); until a past card is in, Past shows "Show all your upcoming
  tickets to see these.". Focus goes to the first new card; a page that adds nothing says "No more
  tickets." and keeps focus on the button (or the heading once it's gone). Back on the tab after 30s, or
  from the back-forward cache, the first page is read again quietly, but only while just the first page is
  in (it would take Show more's cards away): when it changed, "Your tickets were updated.", and focus stays
  on its card (found in its new list) or goes to that list's heading; a failure keeps the cards with a note
  and Try again (then focus on Upcoming, "Tickets updated."); a 401 / 403 swaps in that state with its
  title focused. One polite status line, always there and outside the busy skeletons, says loading, the
  counts when the list arrives, and the above. States: three card skeletons; "Couldn't load your tickets.
  Check your connection, then try again." + Try again (focus to Upcoming after); "No tickets yet." + Find
  an event; signed out (h2, sign in back to `/tickets`, "Bought without an account? Check your email…");
  401 (sign in again); 403 ("Verify your email to see your tickets" → `/verify`). Demo: `sampleMyTickets(now)`
  (`lib/sample-order.ts`, dated from now), drawn in the browser only (the page is static). The order page
  and a received ticket have "← My tickets" above them when signed in (not when the order says another
  account is signed in), as do the demo ticket and the demo's received-ticket notice. No frame for the
  list at 1440 yet (three columns from 1280, as Saved).
- **Settings** (`AccountContent`): two columns of outlined cards from 768 (stacked on phones). Left: Your
  profile, Privacy (Blocked members, privacy link, Delete your profile). Right: Sign-in ("Signed in as … ·
  Google", Sign out: the only log-out below 1024), Events (Your events / Organise events, Organisers you
  follow), how to delete the account. The frames' Notifications, Personalised picks, Username and Email
  aren't built (no backend; owner questions logged).

## Not done / differences kept

- Live Saved cards show no "N going" (list payloads carry no attendance), and the saved heart stays the
  site's orange one.
- No "Today" divider in a thread; Report / Block stand where the frame has "View ticket".
- Dark mode uses the dark token values throughout; Latte to check on staging.
