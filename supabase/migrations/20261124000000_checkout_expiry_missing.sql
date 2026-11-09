-- The checkout pay deadline's sweeper (20261123000000_checkout_pay_deadline.sql;
-- docs/architecture.md "Checkout pay deadline"): a cap on retrying a Stripe
-- session that Stripe says doesn't exist.
--
-- Stripe answering 404 `resource_missing` for an order's session (the wrong
-- Stripe account or mode on this deploy, say) isn't proof the buyer wasn't
-- charged, so the order is never released for it. Until now the sweeper
-- treated it as any other error and retried it hourly for as long as the
-- order stayed pending. Now:
--
--   * private.finish_checkout_expiry takes outcome 'missing' and an optional
--     p_max_missing (default 24): backed off like 'error' (2, 4, 8, 16, 32
--     minutes, then hourly; `attempts` counts both), and once `attempts`
--     reaches p_max_missing it's never looked at again (next_check_at null,
--     last_outcome 'missing'): 'gave_up', which the sweeper logs as a warning
--     (counts only). Nothing is released either way. Needs the lease, like
--     'error' and 'complete'. Everything else is as before; the 3-argument
--     call the previous app version makes still resolves (the new argument
--     has a default).
--   * checkout_expiry_checks.last_outcome may be 'missing'.
--
-- Lock order, access model and grants as in 20261123000000: search_path
-- pinned, not security definer, execute revoked from PUBLIC, anon and
-- authenticated.
--
-- Additive and reversible: restore finish_checkout_expiry and the
-- last_outcome check from 20261123000000_checkout_pay_deadline.sql (first
-- `update private.checkout_expiry_checks set last_outcome = 'error' where
-- last_outcome = 'missing'`).

alter table private.checkout_expiry_checks
  drop constraint checkout_expiry_checks_last_outcome_check,
  add constraint checkout_expiry_checks_last_outcome_check check (last_outcome in ('complete', 'error', 'missing'));

drop function private.finish_checkout_expiry(text, uuid, text);

create function private.finish_checkout_expiry(
  p_order_id text, p_lease_token uuid, p_outcome text, p_max_missing integer default 24
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_result text;
  v_attempts integer;
begin
  if p_order_id is null or p_outcome is null or p_outcome not in ('expired', 'complete', 'error', 'missing')
     or (p_outcome <> 'expired' and p_lease_token is null)
     or p_max_missing is null or p_max_missing < 1 then
    raise exception 'finish_checkout_expiry: invalid arguments' using errcode = '22023';
  end if;

  if p_outcome = 'expired' then
    -- The order's locks first (release_checkout_order), then the check row: the claim's order.
    v_result := private.release_checkout_order(p_order_id);
    delete from private.checkout_expiry_checks c where c.order_id = p_order_id;
    return v_result;
  end if;

  update private.checkout_expiry_checks c
     set lease_token = null, lease_expires_at = null, last_outcome = p_outcome, updated_at = now(),
         attempts = case when p_outcome in ('error', 'missing') then c.attempts + 1 else c.attempts end,
         next_check_at = case
           when p_outcome = 'complete' then null
           when p_outcome = 'missing' and c.attempts + 1 >= p_max_missing then null
           else now() + least(interval '1 hour', interval '2 minutes' * power(2, least(c.attempts, 10))::integer)
         end
   where c.order_id = p_order_id and c.lease_token = p_lease_token
  returning c.attempts into v_attempts;
  if not found then
    return 'lost';
  end if;
  return case when p_outcome = 'missing' and v_attempts >= p_max_missing then 'gave_up' else 'recorded' end;
end;
$$;

revoke all on function private.finish_checkout_expiry(text, uuid, text, integer) from public, anon, authenticated;
