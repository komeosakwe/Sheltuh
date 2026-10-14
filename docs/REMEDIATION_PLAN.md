# Remediation plan: phases 1 and 2

From the owner's audit handover (14 Oct 2026), planned by the software-architect
agent. Nothing here is built yet unless a status line says so. Three audit
findings were verified in the code: free checkout has no rate limiting; the
guest order lookup returns the whole internal order (including Stripe ids and
fees) with no cache protection; a failed ticket email is logged and never
retried.

## Phase 1, in this order (all three edit `lib/server/handlers/orders.ts`)

### Fix 4: guest order data
`GET /api/orders/by-session/{id}` returns only what the confirmation page needs
(status, short order reference, event title and slug, masked email, amounts,
ticket codes and type names). No order id, organiser id, event id, fee split,
Stripe ids, line items or timestamps. Every response is `private, no-store`;
malformed ids get a 404 without a database query; `/checkout/*` pages send
`Referrer-Policy: no-referrer` and noindex; logs use the order reference, never
the order id (which is the page's bearer credential).

### Fix 2: reliable ticket email
Durable `private.email_outbox` (transactional only): jobs are queued inside
`fulfil_order` when an order becomes paid, sent right after the response, and
retried by a cron route every 5 minutes (1 min, 5 min, 30 min, 2 h, 6 h, then
`failed` after 6 attempts, with jitter). Idempotent against duplicate webhooks
and concurrent workers; a mail failure never undoes a purchase. Delivery is
at-least-once, so an occasional duplicate email is possible. Admin list of jobs
(never full addresses or order ids) and a rate-limited manual resend at
`/admin/emails`. New env var: `CRON_SECRET`.

### Fix 1: free-ticket abuse protection
No IP addresses (forwarded headers are only trustworthy when Vercel is the first
hop, and shared Wi-Fi puts many people behind one address). Instead:
- Signed-in member with a verified email matching the buyer: tickets immediately,
  limited to 10 free claims a day per account.
- Guest: the order is recorded as pending and a confirmation link is emailed
  (token in the URL fragment; the page has a Confirm button that POSTs, so mail
  scanners can't confirm by accident). Tickets are issued only on confirmation;
  no inventory is held before then, so a flood cannot drain an event.
- Caps: 4 free tickets per order, 4 per person per event (normalised email: case,
  `+tag` and Gmail dots), 3 unconfirmed links per address per hour, 300
  confirmation emails per hour platform-wide.
- Refusal counts are stored without any email or IP. No CAPTCHA for now.

## Phase 2: ticket check-in (Fix 3)

- The QR encodes the existing ticket code as `SH1:XXXX-XXXX`. Codes are 40-bit
  random (about 1.1 x 10^12 values); the only way to test a code is check-in,
  which needs an organiser login, is scoped to that organiser's event and is
  rate-limited, so no new token is needed.
- `private.check_in_ticket` redeems atomically (locks order then ticket, the same
  order `fulfil_order` uses), idempotent on a request id, with an audit table
  (`ticket_check_ins`: who, when, event, result; invalid scans never store the
  scanned text). Outcomes: admitted, already checked in (with the first time),
  invalid (another event's ticket looks the same as an unknown one),
  not admissible (order not paid or refunded), and a clear "verification
  unavailable" state on network errors that never marks anything redeemed.
- Re-entry is refused by default; a supervisor-style Undo with a required reason
  corrects mistakes and is audited. Offline check-in is explicitly not supported.
- Authorisation: the approved organiser for that event now; a later
  `event_staff` table (scanner or supervisor, per event). Admins cannot check in.
- Organiser page `/dashboard/[eventId]/check-in`: camera scanner (native
  BarcodeDetector, with the MIT `barcode-detector` ZXing-WASM fallback for
  iPhone Safari, loaded only on this page), manual code entry always visible,
  duplicate-frame suppression, live counters, recent log, accessible
  announcements, optional vibration, screen kept awake.
- QR images: drawn as SVG on the ticket page; attached inline (PNG generated with
  Node's zlib, QR from the MIT `qrcodegen` single file) in the ticket email,
  because Gmail strips SVG and data URIs and a hosted URL would leak codes to
  image proxies. The text code stays in the email.

## Order and agents

1. Wait for the analytics backend to commit (it also edits `orders.ts`).
2. Backend: Fix 4, then Fix 2, then Fix 1 (sequential, shared files); frontend
   pieces follow each contract. Then test engineer, code and security review,
   accessibility review, fixes, quality gates.
3. Phase 2: backend check-in data and API, then QR generation, then the scanner UI.

Migration names reserved: `20261014000000_email_outbox.sql`,
`20261014000100_free_order_protection.sql`, `20261021000000_ticket_check_in.sql`.

## Open decisions (recommended default in brackets)

1. Guests confirm free tickets by an emailed link; verified members instantly [yes].
2. The caps above [as listed].
3. QR carries the existing code, no separate token [yes].
4. Confirmation page shows a masked email [yes].
5. Retries on Vercel Cron every 5 minutes [yes; Supabase Cron if on Hobby,
   where Vercel crons run at most daily. Unverified against Vercel's docs].
6. Keep the check-in log 25 months after the event [yes].
7. Only the organiser checks people in; admins cannot [yes].
8. Refuse re-entry by default [yes].
9. No Turnstile or IP limits at launch [yes].
10. Keep `/dashboard/[eventId]/check-in`; unify dashboard route styles later [yes].
11. Handle Stripe's `charge.refunded` before check-in goes live (refunds made in the
    Stripe dashboard currently leave an order `paid`, so refunded tickets would
    still be admitted) [yes, separate task].

## Cost and risks

Extra monthly cost is about A$0 (cron inside Vercel Pro, which is needed to sell
tickets anyway; the scanner's WASM file is static). Risks: the Workspace SMTP
daily quota is shared between ticket and confirmation emails; at-least-once
delivery; iPhone depends on the WASM scanner path (needs real-device testing);
`/checkout/success?session_id=` URLs appear in Vercel request logs (fixing that
would break already-emailed links, low priority).
