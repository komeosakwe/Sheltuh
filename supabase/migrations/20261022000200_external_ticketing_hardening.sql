-- External ticketing hardening (security review of B2,
-- 20261022000000_external_ticketing.sql; docs/architecture.md, "External
-- ticketing"):
--
--   * private.record_outbound_click: once the event's per-minute cap is
--     reached, a refused click marks the day cap_reached with one write, the
--     first time only. Every refusal after that is plain reads (the cap's
--     counter, then the day's flag): no row lock and no transaction id, so
--     a flood over the cap costs no writes.
--   * private.external_ticket_url_ok also refuses a host whose last label is
--     all digits or starts with 0x (IPv4 written in hex, octal or mixed
--     forms, e.g. https://0x7f.1/). The API's URL parser already turns those
--     into an IP address (refused) or rejects them; this keeps the database's
--     check as strict for anything written around the API.
--   * More link shorteners and link-in-bio redirectors (j.mp, tiny.one,
--     rotf.lol, ht.ly, dlvr.it, ift.tt, qrco.de, linktr.ee, lnk.to, ffm.to,
--     smarturl.it), mirrored in lib/ticketing.ts (LINK_SHORTENER_HOSTS);
--     tests/server/ticketing-url.test.ts checks the lists agree.
--
-- The events_external_ticket_url_valid constraint calls the function, so it
-- applies to every new or changed link straight away. Existing rows aren't
-- re-checked (Postgres doesn't revalidate a check constraint when its
-- function changes); none should exist before launch. To check by hand:
--   select id, external_ticket_url from public.events
--    where external_ticket_url is not null and not private.external_ticket_url_ok(external_ticket_url);
--
-- Not destructive. Reversible: recreate both functions from
-- 20261022000000_external_ticketing.sql. Functions only: no table, grant or
-- index changes.

create or replace function private.external_ticket_url_ok(p_url text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     -- Printable ASCII, no space; no backslash (URL parsers read it as "/").
     and p_url ~ '^[!-~]+$'
     and strpos(p_url, chr(92)) = 0
     -- https://, then a host of DNS labels (so no credentials, port, IPv6
     -- literal or trailing dot), then optionally a path, query or fragment.
     and p_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$'
     and not exists (
       select 1
         from (select substring(p_url from '^https://([^/?#]+)') as host) h
        where h.host ~ '^[0-9.]+$'
           -- A last label that's a number (decimal, octal or hex) makes the
           -- whole host an IPv4 address to a URL parser (0x7f.1 is 127.0.0.1).
           or h.host ~ '(^|\.)([0-9]+|0x[0-9a-f]*)$'
           or h.host ~ '(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|test|invalid|example|onion)$'
           or h.host ~ ('(^|\.)(adf\.ly|bit\.do|bit\.ly|bitly\.com|bl\.ink|buff\.ly|cutt\.ly|dlvr\.it|dub\.sh|fb\.me'
                        || '|ffm\.to|goo\.gl|ht\.ly|ift\.tt|is\.gd|j\.mp|linktr\.ee|lnk\.to|lnkd\.in|ow\.ly|qrco\.de'
                        || '|rb\.gy|rebrand\.ly|rotf\.lol|s\.id|short\.io|shorturl\.at|smarturl\.it|t\.co|t\.ly'
                        || '|tiny\.cc|tiny\.one|tinyurl\.com|trib\.al|v\.gd)$')
     );
$$;

revoke all on function private.external_ticket_url_ok(text) from public, anon, authenticated;

-- As in 20261022000000_external_ticketing.sql, except that a refused click
-- writes only while the day isn't flagged yet.
create or replace function private.record_outbound_click(p_event_id uuid, p_limit integer, p_window interval)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
begin
  perform 1 from public.events e
   where e.id = p_event_id and e.status = 'published' and e.ticketing_mode = 'external';
  if not found then
    return 'not_found';
  end if;

  if not private.take_event_rate_limit(p_event_id, 'outbound', p_limit, p_window) then
    -- A plain read first: once the day is flagged, a refusal writes nothing.
    perform 1 from public.event_outbound_clicks c
     where c.event_id = p_event_id and c.day = v_day and c.cap_reached;
    if not found then
      insert into public.event_outbound_clicks as c (event_id, day, clicks, cap_reached)
      values (p_event_id, v_day, 0, true)
      on conflict (event_id, day) do update set cap_reached = true where not c.cap_reached;
    end if;
    return 'rate_limited';
  end if;

  insert into public.event_outbound_clicks as c (event_id, day, clicks)
  values (p_event_id, v_day, 1)
  on conflict (event_id, day) do update set clicks = c.clicks + 1;
  return 'recorded';
end;
$$;

revoke all on function private.record_outbound_click(uuid, integer, interval) from public, anon, authenticated;
