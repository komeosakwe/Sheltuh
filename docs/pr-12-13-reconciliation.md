# PR #12 and PR #13: reconciliation

Merge commit `9eabcd2` on `claude/gifted-cannon-k40f9j`: PR #12
(`claude/qr-ticketing`, QR tickets) merged into PR #13 (the redesign, waitlist,
profiles, seating and security hardening, head `18ae2d2`). Common base
`a7fcfcd`.

**Rule used:** keep every still-valid behaviour from both. Where both built the
same thing, keep one implementation, #13's shared email layout and brand tokens,
and port #12's additions into it.

## Unlisted events: one implementation, #12's

Hiding an event's date, time, venue and address once it's no longer published
exists **only in #12**. #13 has no equivalent: its `CustomerOrder` carried no
event times or venue, and its ticket email always printed them. The combined
version keeps #12's rule unchanged, at every layer:

- **API:** `toCustomerOrder` returns `eventListed`. It returns start, end, venue
  and suburb only while the order is `paid` and the event's `status =
  'published'`. A missing event (left join) counts as unlisted.
- **Email:** `buildTicketEmail` replaces the details with
  `EVENT_UNLISTED_TEXT`. Because the outbox rebuilds the email from the live
  event, retries and resends follow the event's status at send time.
- **UI:** `CheckoutConfirmation` and `TicketStub` show "This event is no longer
  listed. Contact support@…", with no link to the event page.

**Tests:** `tests/server/ticket-page.test.ts`, `ticket-email.test.ts`,
`email-outbox.test.ts` (retry and resend after unpublishing),
`tests/CheckoutConfirmation.test.tsx` and `tests/TicketStub.test.tsx`.

## Files both PRs changed

| File | #13 | #12 | Combined |
| --- | --- | --- | --- |
| `lib/server/ticket-email.ts` | Rebuilt on the shared `email-layout.ts` (cream page, white card, Signal Orange only on the button). Seat line per ticket, `subjectLine`, "View your ticket(s)" button, header with the app icon beside the text "Sheltüh". | Its own full HTML: wordmark PNG on a black band, uppercase "YOU'RE IN.", "VIEW MY TICKETS". Unlisted-event hiding, Outlook-safe button, `mso-hide` preheader, "Backup code" label, QR alt text pointing at it, perforation, `ticketPageLink`. | #13's layout, seat lines, button label and `subjectLine`. Ported from #12: unlisted hiding, Backup/Entry code label, QR alt text, perforation, `ticketPageLink`, the plain-text "SHELTÜH" line, and the wordmark header. Dropped from #12, because the brand tests forbid them: the black band, the orange alt text, the uppercase heading, "VIEW MY TICKETS", and its own palette and markup. |
| `lib/api/types.ts` | Inline ticket type with `seat`. | `CustomerTicket` (with `checkedInAt`), plus `eventListed`, `eventStartsAt`, `eventEndsAt`, `venueName` and `suburb` on `CustomerOrder`. | `CustomerTicket` with both `seat` and `checkedInAt`. All additions are optional, so the contract only grows. |
| `lib/server/records.ts` | `json_strip_nulls` ticket JSON with the seat lookup (`TICKET_SEAT_JSON`), via a slug subquery. | A left join on events for status, times, venue and suburb, plus `checked_in_at` in the ticket JSON. | #12's join plus #13's seat lookup and `checkedInAt` in one `json_strip_nulls` object. A missing seat or a null check-in is mapped back to null or omitted. |
| `components/tickets/TicketStub.tsx` | Seat line, rounded card, `bg-card`. | Event title, when and where, unlisted line, Backup/Entry label, "Ready to scan" or "Checked in …" status, 5-row grid. | Everything from both: the seat sits under the type, above the event. |
| `components/CheckoutConfirmation.tsx` | `Strap` header, sort by seat, totals card, `forgetPendingCheckout`. | Passes event details, the unlisted flag and `checkedInAt` to each stub. Event links hidden when unlisted. | Both. Stubs get `seat` and #12's props, in #13's seat order. |
| `scripts/preview-ticket-email.ts` | Previews the other emails (free-ticket, waitlist, follower). | Unlisted scenario, images-blocked page, `--screenshots`. | Both. The other emails are renumbered 8 to 11 after #12's scenario 7. |
| `docs/architecture.md` | The shared email layout. | The QR email, the ticket page's event details, unlisted hiding. | Both, describing the one combined email and the Outlook notes in the layout. |
| `tests/server/ticket-email.test.ts` | Header and button-label tests for its layout. | Full redesign suite for its own HTML. | #12's suite, with expectations changed only where #13's layout changes the output (see below), plus a seated-ticket test. #13's header-icon test is replaced by the wordmark test. |
| `tests/TicketStub.test.tsx`, `tests/CheckoutConfirmation.test.tsx`, `tests/server/orders.test.ts` | Seat assertions. | Event details, status, unlisted, `checkedInAt`. | Both. These merged textually except `TicketStub.test.tsx`, which was hand-resolved to keep both sets. |

## Related files changed only by one PR

| File | Change in the merge |
| --- | --- |
| `lib/server/email-layout.ts` (#13) | Now carries #12's Outlook fixes for **every** email: `mso-padding-alt` on the button cell, `mso-hide:all`/`max-width:0` on the preheader, and `bgcolor` on `<body>`. |
| `lib/server/email-wordmark.ts`, `scripts/render-email-wordmark.ts`, `public/brand/sheltuh-wordmark-email.png` (#12) | Re-rendered to the export `brand-direction-one.md` §11 #6 specifies: black on cream, 212×48 (about 4 KB), shown at 106×24. #12 had Signal Orange on transparent at 300×68. The PNG is attached inline (`cid:`) like the QR codes, so it still shows when Outlook blocks remote images, with alt text "SHELTÜH" (manager decision). The render script takes ink and cream from the shared tokens. |
| `tests/server/email-brand.test.ts` (#13) | The paid ticket email now has three `cid:` images (the wordmark and two QR codes) instead of two. The shared-token and one-orange-button rules hold unchanged. |
| `tests/server/email-outbox.test.ts` (#12) | Asserts the attachment order (wordmark, then QR) by cid. |
| `docs/design/brand-direction-one.md` (#13) | §11 #6 marked done, with the owner still to confirm the export. |

## #12 test expectations changed, and why

All of these follow from #13's shared layout, which the brand test enforces:

- **Button:** "View your ticket(s)" instead of "VIEW MY TICKETS", and padding 14px 28px (still 50px tall, and `mso-padding-alt` still asserted).
- **Heading:** no longer uppercase. #13's shared 28px heading is used.
- **Ticket card:** 10px radius instead of 12px.
- **Colours:** a subset of `EMAIL_COLOURS` (#13 adds muted and divider), still including the four brand colours. The old palette is still forbidden.
- **Wordmark:** sits above the card on cream, not on a black band, so the alt text is black at 20px (it was orange at 28px). The test also pins the 24px height.
- **Support line:** #13's shared `supportFooter` ("Need help? Email support@…"), without "and quote your order reference".
- **Inline images:** three (wordmark plus QR codes). #13's own test expected two.

No security or privacy assertion was removed or loosened. Kept as they were:

- the unlisted-event checks;
- QR attachment names that never contain the code;
- a footer-banner URL that carries no order data;
- tickets only for a `paid` order;
- no street address on the ticket page.

## Open items

- The owner still has to confirm the wordmark PNG export (§11 #6).
- `e2e/checkout-success-qr.spec.ts` (#12) merged textually against #13's redesigned confirmation page, but e2e wasn't run.
- Run `npm run build` and the e2e suite before merging to main.
