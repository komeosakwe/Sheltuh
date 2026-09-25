-- Oversold orders are now refunded automatically by the Stripe webhook
-- (lib/server/handlers/orders.ts). `oversold_refund_required` now means "refund
-- not yet confirmed" and `refunded` means Stripe accepted the refund.
alter type public.order_status add value if not exists 'refunded';

-- When the ticket email went out, so a failed send is visible (and can be
-- retried) rather than silent.
alter table public.orders add column tickets_emailed_at timestamptz;
