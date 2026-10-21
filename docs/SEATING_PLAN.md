# Reserved seating: MVP plan

Owner request (21 Oct 2026): optional reserved seating for concert-style
events, with an interactive seat map. Planned by the software-architect agent;
decisions below were made by the manager while the owner was away (the
architect's recommended defaults). Nothing here is built yet.

## Shape

- A seat map is optional per event. General admission stays the default and
  its payloads and code paths are unchanged.
- Seats point at the event's existing ticket types (price tiers), so fees
  (`lib/fees.ts`), all-inclusive prices, orders, analytics, refunds and the
  waitlist keep working on ticket types.
- `public.event_seat_maps` (layout, version, seat count) and
  `public.event_seats` (section, row and seat labels, coordinates, tier, kind:
  standard, wheelchair or companion; blocked; hold order and expiry; sold
  order). `tickets.seat_id` links a ticket to its seat. RLS on, no grants.
- A seated tier's capacity is derived from its unblocked seats.
- Holds are created when the buyer presses Checkout, in the same transaction
  as the pending order, and last 35 minutes (Stripe Checkout's minimum expiry
  is 30). They expire lazily (no cron) and are released at once on Stripe
  session expiry, a Stripe error, or the buyer cancelling. `fulfil_order`
  marks seats sold; a full refund releases them (waitlist notified).
- Lock order everywhere: advisory per-event lock, order, event, ticket types
  (id order), seats (id order). Real-Postgres race tests are required.

## Buyer

- `/events/[slug]/seats`: SVG map (pan and zoom on phones, zoom buttons, seat
  numbers when large enough, rounded-square seats, selected = orange with a
  black check) plus an equivalent list (sections, rows, checkboxes) for
  keyboard and screen readers. "Find seats" suggests adjacent best-available
  seats. Summary lists each seat's all-inclusive price, then the total.
- Availability is a small bitmap (sold, held and blocked look the same),
  polled every 10 seconds while visible and cached 5 seconds at the CDN.
- Seat labels on the ticket page, email and door scanner (spoken too).

## Organiser and admin

- Editor: rectangular and curved section generators (rows × seats, row and
  seat labelling schemes), per-seat edits (tier, wheelchair, companion, block,
  delete, relabel), JSON import and export, preview as buyer.
- The map freezes at first approval. Admins can replace it later only while
  the event has no orders; logged.

## Decisions (manager, owner away)

1. Hold length 35 minutes, released instantly on cancel or expiry.
2. Mixed events allowed: general admission tiers appear as steppers on the
   seat page.
3. The public map shows unavailable seats (one combined state); disclose in
   the Organiser Agreement.
4. At most 10 seats per order.
5. Anti-hoarding: per event, 120 hold attempts per 10 minutes, and at most the
   larger of 20 seats or 30% of sellable seats held at once.
6. Wheelchair and companion seats bookable by anyone after a confirmation
   prompt; Companion Card handling later.
7. Guest free bookings: seats aren't held until the email link is confirmed.
8. All approved organisers can build seat maps, with admin review.
9. Map changes after approval: admins only, before any order; live
   block/unblock in phase 2.
10. "Best seats" focus point: stage centre, movable by the organiser.

## Phases

MVP: design spec (`docs/design/seating.md`), migrations
`20261101000000_reserved_seating.sql` and `20261101000100_seat_holds.sql`,
map and availability APIs, seated checkout and cancel, webhook, refunds,
issuance, emails, check-in seat lines, seat page, editor, admin preview,
demo seated event, tests (unit, server, real-Postgres races, components,
e2e at 320/375/desktop), then security, accessibility, visual and code
reviews.

Later: live block/unblock, organiser seat chart, standing areas on the map,
venue template library, hold on tap with an embedded checkout countdown,
Realtime, Companion Card flow, move-seat tool, Turnstile on holds.

Legal: Purchase Terms need hold, seat assignment and wheelchair wording; the
Organiser Agreement needs map accuracy and sales visibility.
