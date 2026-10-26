-- Wallet pass serials (docs/architecture.md, "Wallet passes").
--
--   * public.tickets.wallet_serial: a random uuid per ticket, the id of its
--     wallet pass (Apple's serialNumber, the end of Google's object id
--     `{issuerId}.sheltuh-ticket-{serial}`, both as 32 hex characters without
--     dashes). Random, so it says nothing about the ticket's code: a serial
--     derived from the code (a hash) could be reversed by trying all 2^40
--     codes, and a pass's serial can never change once it's in a wallet.
--     Unique (tickets_wallet_serial_key), so two tickets can never share a
--     pass. Read only by the wallet pass routes (lib/server/handlers/wallet.ts),
--     never returned by any other API.
--
-- gen_random_uuid() is core Postgres (13+), as every other uuid default here
-- (20260925000000_init.sql); no extension needed.
--
-- No other index: it's never filtered or sorted on (the unique constraint's
-- index exists anyway). Every insert into public.tickets names its columns
-- (fulfil_order and its seated form), so the default fills new rows.
--
-- Additive. Adding a column with a volatile default rewrites public.tickets
-- once, giving every existing ticket its own serial, under the ALTER's
-- ACCESS EXCLUSIVE lock (brief at pre-launch volumes: ticket issuance and
-- check-in wait for it), then builds the unique index. Reversible: drop the
-- column (the app needs its previous version first, since the wallet routes
-- read it); passes already saved keep their old serials, so dropping and
-- re-adding it would give every ticket a new pass.

alter table public.tickets
  add column wallet_serial uuid not null default gen_random_uuid(),
  add constraint tickets_wallet_serial_key unique (wallet_serial);
